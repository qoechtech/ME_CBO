import { Injectable, Logger, OnModuleInit } from "@nestjs/common";
import * as nodemailer from "nodemailer";
import type { Transporter } from "nodemailer";
import * as fs from "node:fs";
import * as path from "node:path";
import * as Handlebars from "handlebars";

type TemplateName =
  | "verify-email"
  | "reset-password"
  | "set-password"
  | "donation-receipt"
  | "certificate-delivery";

@Injectable()
export class EmailService implements OnModuleInit {
  private readonly logger = new Logger(EmailService.name);
  private transporter!: Transporter;
  private readonly from: string;
  private readonly templates = new Map<TemplateName, Handlebars.TemplateDelegate>();

  constructor() {
    this.from = process.env.SMTP_FROM ?? "ME_CBO <noreply@mecbo.org>";
  }

  async onModuleInit() {
    this.transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST ?? "localhost",
      port: Number(process.env.SMTP_PORT ?? 587),
      secure: process.env.SMTP_SECURE === "true",
      // Fail fast instead of hanging a request when the mail server is slow.
      connectionTimeout: 10_000,
      greetingTimeout: 10_000,
      socketTimeout: 15_000,
      auth: process.env.SMTP_USER
        ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS ?? "" }
        : undefined,
    });

    const dir = path.join(__dirname, "templates");
    const names: TemplateName[] = [
      "verify-email",
      "reset-password",
      "set-password",
      "donation-receipt",
      "certificate-delivery",
    ];
    for (const name of names) {
      const p = path.join(dir, `${name}.hbs`);
      if (fs.existsSync(p)) {
        const src = fs.readFileSync(p, "utf8");
        this.templates.set(name, Handlebars.compile(src));
      } else {
        this.logger.warn(`Template not found: ${p}`);
      }
    }

    // Do not block start-up on the mail server.
    void this.transporter
      .verify()
      .then(() => this.logger.log("SMTP transporter ready"))
      .catch((err) =>
        this.logger.warn(`SMTP verify failed (dev continues): ${(err as Error).message}`),
      );
  }

  private async send(
    to: string,
    subject: string,
    html: string,
    attachments?: Array<{ filename: string; content: Buffer | string; contentType?: string }>,
  ): Promise<void> {
    try {
      await this.transporter.sendMail({ from: this.from, to, subject, html, attachments });
      this.logger.log(`Email sent → ${to} — "${subject}"`);
    } catch (err) {
      this.logger.error(`Email send failed → ${to}: ${(err as Error).message}`);
      throw err;
    }
  }

  async sendVerification(to: string, fullName: string, verifyUrl: string): Promise<void> {
    const tpl = this.templates.get("verify-email");
    if (!tpl) throw new Error("verify-email template missing");
    await this.send(to, "Verify your ME_CBO email", tpl({ fullName, verifyUrl }));
  }

  async sendPasswordReset(to: string, resetUrl: string): Promise<void> {
    const tpl = this.templates.get("reset-password");
    if (!tpl) throw new Error("reset-password template missing");
    await this.send(to, "Reset your ME_CBO password", tpl({ resetUrl }));
  }

  /** Welcome email for members added or approved by an admin: set your password. */
  async sendInvite(to: string, fullName: string, setPasswordUrl: string): Promise<void> {
    const tpl = this.templates.get("set-password");
    if (!tpl) throw new Error("set-password template missing");
    await this.send(
      to,
      "Welcome to ME_CBO — set your password",
      tpl({ fullName, setPasswordUrl }),
    );
  }

  async sendDonationReceipt(
    to: string,
    data: {
      donorName: string;
      amountKes: string;
      receiptNumber: string;
      method: string;
      date: string;
    },
  ): Promise<void> {
    const tpl = this.templates.get("donation-receipt");
    if (!tpl) throw new Error("donation-receipt template missing");
    await this.send(to, `Thank you for your donation — ${data.amountKes}`, tpl(data));
  }

  async sendCertificate(
    to: string,
    data: {
      memberName: string;
      certificateTitle: string;
      verificationCode: string;
      pdfBuffer: Buffer;
    },
  ): Promise<void> {
    const tpl = this.templates.get("certificate-delivery");
    if (!tpl) throw new Error("certificate-delivery template missing");
    await this.send(
      to,
      "Your ME_CBO impact certificate",
      tpl(data),
      [{ filename: "ME_CBO-certificate.pdf", content: data.pdfBuffer, contentType: "application/pdf" }],
    );
  }
}
