"""
Passport automated monkey audit via Browser Use.
Runs through auth, session, admin, evidence, and rate-limit checks.

Usage:
  1. Set ANTHROPIC_API_KEY or OPENAI_API_KEY
  2. Run: python audit/run_audit.py
  3. Watch the browser window — type your password when prompted on screen
"""

import os, sys, json, asyncio
from datetime import datetime, timezone

api_key = os.environ.get("ANTHROPIC_API_KEY") or os.environ.get("OPENAI_API_KEY")
if not api_key:
    print("ERROR: Set ANTHROPIC_API_KEY or OPENAI_API_KEY")
    sys.exit(1)

from browser_use import Agent
from browser_use.tools.service import Tools as Controller
from browser_use.llm.litellm import ChatLiteLLM

PASSWORD = input("Enter your passport.metis.gold password: ").strip()
COMMITMENT = "87cfa2bfe15782572d40b0669d83504be9409b0475c91db646ec694f279ca2f6"

AUDIT_PROMPT = f"""
You are auditing passport.metis.gold. Execute every step IN ORDER and record results.

CONTEXT:
- URL: https://passport.metis.gold
- Login email: izzyblast2010@gmail.com
- Login password: {PASSWORD}
- Enrolled agent commitment: {COMMITMENT}

=== SECTION 1: AUTH & SESSION ===

1a. GET /api/auth/session with NO cookie
     Expect: 401, Cache-Control: no-store

1b. POST /api/auth/login with wrong password ("wrongpassword123")
     Expect: 401 with JSON error (NOT HTML, no stack trace)

1c. Navigate to /login — fill email + password, submit
     Wait for redirect to /admin
     Verify the dashboard loads fully (metrics, health, activity)
     Look for "executiveAdmin":true in any visible data

1d. GET /api/auth/session WHILE LOGGED IN
     Expect: 200, {{\"authenticated\":true,"executiveAdmin":true}}

=== SECTION 2: PUBLIC KEY ===

2a. GET /api/v1/public-key
     Expect: 200, algorithm "ed25519", 64-hex key
     Check Cache-Control header — must NOT have "immutable"

=== SECTION 3: PROFILES & LEADERBOARD ===

3a. GET /api/v1/profiles/{COMMITMENT}
     Expect: 200, enrollment_status "ENROLLED", evidence_count >= 1

3b. GET /api/v1/leaderboard
     Expect: 200 with leaderboard array

=== SECTION 4: EVIDENCE ===

4a. POST to /api/v1/passport/agents/{COMMITMENT}/evidence
     Body: {{\"source_type":"github_commit_payload","payload":{{}},"signature":"invalid"}}
     Expect: 400 or 401 with specific error (NOT 500)

=== SECTION 5: DOCS ===

5a. Navigate to /docs/integrate — verify 6 numbered steps are visible
5b. Navigate to /public-key — verify key, badge preview, verify tool
5c. Navigate to /docs/api-reference — verify canonicalization section exists

=== REPORT ===
After all steps, print a clear PASS/FAIL summary for each section.
If every section passes, print "AUDIT: ALL PASSED".
"""

async def main():
    print("=" * 60)
    print("PASSPORT MONKEY AUDIT")
    print("=" * 60)
    print(f"Agent commitment: {COMMITMENT}")
    print(f"Starting browser audit... (watch the browser window)\n")

    llm = ChatLiteLLM(
        model="claude-sonnet-4-20250514",
        api_key=os.environ.get("ANTHROPIC_API_KEY"),
        temperature=0,
        max_tokens=8192,
    )

    controller = Controller()
    agent = Agent(
        task=AUDIT_PROMPT,
        llm=llm,
        controller=controller,
        use_vision=True,
    )

    history = await agent.run(max_steps=80)

    print("\n" + "=" * 60)
    print("AUDIT COMPLETE")
    print("=" * 60)

if __name__ == "__main__":
    asyncio.run(main())