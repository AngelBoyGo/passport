import json
import os
import unittest
from io import BytesIO
from unittest import mock
from urllib.error import HTTPError, URLError

from passport_sdk.client import PassportClient
from passport_sdk.exceptions import PassportHTTPError


class PassportClientRetryTests(unittest.TestCase):
    def setUp(self):
        self.env = mock.patch.dict(
            os.environ,
            {
                "PASSPORT_API_KEY": "pk_test",
                "PASSPORT_BASE_URL": "http://passport.test",
            },
            clear=False,
        )
        self.env.start()

    def tearDown(self):
        self.env.stop()

    @mock.patch("passport_sdk.client.time.sleep")
    @mock.patch("passport_sdk.client.urlopen")
    def test_retries_5xx_then_succeeds(self, urlopen_mock, sleep_mock):
        ok_body = json.dumps({"receipt_id": "rcpt_1", "status": "pending"}).encode()
        urlopen_mock.side_effect = [
            HTTPError(
                "http://passport.test/api/v1/receipts",
                503,
                "unavailable",
                hdrs=None,
                fp=BytesIO(b""),
            ),
            mock.Mock(read=lambda: ok_body, status=201, __enter__=lambda s: s, __exit__=mock.Mock()),
        ]

        client = PassportClient()
        result = client.issue_receipt(
            agent_id="agent-1",
            receipt_type="competence",
            input_digest="abc",
            authority_scope="test",
            expiry="2026-07-14T00:00:00Z",
        )

        self.assertEqual(result["receipt_id"], "rcpt_1")
        self.assertEqual(urlopen_mock.call_count, 2)
        sleep_mock.assert_called_once_with(0.2)

    @mock.patch("passport_sdk.client.urlopen")
    def test_does_not_retry_4xx(self, urlopen_mock):
        urlopen_mock.side_effect = HTTPError(
            "http://passport.test/api/v1/receipts",
            400,
            "bad request",
            hdrs=None,
            fp=BytesIO(json.dumps({"error": "invalid"}).encode()),
        )

        client = PassportClient()
        with self.assertRaises(PassportHTTPError) as ctx:
            client.issue_receipt(
                agent_id="agent-1",
                receipt_type="competence",
                input_digest="abc",
                authority_scope="test",
                expiry="2026-07-14T00:00:00Z",
            )

        self.assertEqual(ctx.exception.status, 400)
        self.assertEqual(urlopen_mock.call_count, 1)

    @mock.patch("passport_sdk.client.urlopen")
    def test_uses_4s_timeout(self, urlopen_mock):
        body = json.dumps({"allow_invocation": True, "reason": "ok"}).encode()
        urlopen_mock.return_value = mock.Mock(
            read=lambda: body,
            status=200,
            __enter__=lambda s: s,
            __exit__=mock.Mock(),
        )

        client = PassportClient()
        client.query_gate("op_test", "CODE_GENERATION")

        _request, kwargs = urlopen_mock.call_args
        self.assertEqual(kwargs["timeout"], 4.0)


class PassportClientThreadSafetyTests(unittest.TestCase):
    def test_has_request_lock(self):
        client = PassportClient(api_key="pk", base_url="http://localhost")
        self.assertTrue(hasattr(client, "_request_lock"))


if __name__ == "__main__":
    unittest.main()
