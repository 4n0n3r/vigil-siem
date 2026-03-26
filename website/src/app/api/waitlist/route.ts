import { NextRequest, NextResponse } from "next/server";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { name, email } = body;

    if (!name || !email) {
      return NextResponse.json(
        { error_code: "VALIDATION_ERROR", message: "name and email are required" },
        { status: 400 }
      );
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return NextResponse.json(
        { error_code: "VALIDATION_ERROR", message: "invalid email address" },
        { status: 400 }
      );
    }

    // Log to console for now (wire up Resend when API key is available)
    console.log(`[waitlist] ${name} <${email}>`);

    // Optionally send via Resend if key is configured
    const resendKey = process.env.RESEND_API_KEY;
    if (resendKey) {
      try {
        const { Resend } = await import("resend");
        const resend = new Resend(resendKey);
        await resend.emails.send({
          from: "Vigil <noreply@vigilsec.io>",
          to: [email],
          subject: "You're on the Vigil Cloud waitlist",
          text: `Hi ${name},\n\nThanks for joining the Vigil Cloud waitlist. We'll reach out when managed hosting launches.\n\nIn the meantime, you can self-host Vigil: https://github.com/your-org/vigil\n\n— The Vigil team`,
        });
      } catch (emailErr) {
        console.error("[waitlist] email send failed:", emailErr);
        // Don't fail the request if email fails
      }
    }

    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json(
      { error_code: "INTERNAL_ERROR", message: "unexpected error" },
      { status: 500 }
    );
  }
}
