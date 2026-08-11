import { redirect } from "next/navigation";

/**
 * Demo verification alias at /verify/demo.
 */
export default function VerifyDemoPage() {
  redirect("/verify/demo-receipt-001");
}