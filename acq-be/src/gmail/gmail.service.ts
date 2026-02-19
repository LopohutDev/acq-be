import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { google } from 'googleapis';
import { PrismaService } from '../prisma/prisma.service';
import { EmailLogService } from '../email-log/email-log.service';

const OAuth2 = google.auth.OAuth2;

interface GmailTokens {
  access_token: string;
  refresh_token?: string;
  expiry_date?: number;
}

@Injectable()
export class GmailService {
  private readonly logger = new Logger(GmailService.name);

  constructor(
    private prisma: PrismaService,
    private emailLogService: EmailLogService,
  ) {}

  private getSystemOAuth2Client() {
    const clientId = process.env.GOOGLE_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
    const redirectUri = process.env.GOOGLE_REDIRECT_URI;

    if (!clientId || !clientSecret || !redirectUri) {
      throw new BadRequestException('Google OAuth credentials not configured');
    }

    return new OAuth2(clientId, clientSecret, redirectUri);
  }

  private async getSystemGmailClient() {
    const email = process.env.SYSTEM_GMAIL_EMAIL;
    const accessToken = process.env.SYSTEM_GMAIL_ACCESS_TOKEN;
    const refreshToken = process.env.SYSTEM_GMAIL_REFRESH_TOKEN;

    if (!email || !accessToken || !refreshToken) {
      throw new BadRequestException('System Gmail not configured');
    }

    const oauth2Client = this.getSystemOAuth2Client();
    oauth2Client.setCredentials({
      access_token: accessToken,
      refresh_token: refreshToken,
    });

    return {
      gmail: google.gmail({ version: 'v1', auth: oauth2Client }),
      email,
    };
  }

  async sendSystemEmail(
    to: string | string[],
    subject: string,
    body: string,
    bookingId?: string,
  ): Promise<{ success: boolean; messageId?: string; error?: string }> {
    const { gmail, email: fromEmail } = await this.getSystemGmailClient();
    const recipients = Array.isArray(to) ? to : [to];

    // Create email log
    const emailLog = await this.emailLogService.createLog({
      fromEmail,
      recipientEmail: recipients.join(', '),
      subject,
      body,
      bookingId,
    });

    try {
      const results: string[] = [];
      for (const recipient of recipients) {
        const rawEmail = this.createRawEmail(
          fromEmail,
          recipient,
          subject,
          body,
        );

        const response = await gmail.users.messages.send({
          userId: 'me',
          requestBody: {
            raw: rawEmail,
          },
        });

        if (response.data.id) {
          results.push(response.data.id);
        }
        this.logger.log(`System email sent from ${fromEmail} to ${recipient}`);
      }

      await this.emailLogService.markAsSent(emailLog.id, results[0]);

      return {
        success: true,
        messageId: results[0],
      };
    } catch (error) {
      this.logger.error(`Failed to send system email: ${error.message}`);
      await this.emailLogService.markAsFailed(emailLog.id, error.message);

      throw new BadRequestException(`Failed to send email: ${error.message}`);
    }
  }

  getSystemGmailStatus(): { configured: boolean; email?: string } {
    const email = process.env.SYSTEM_GMAIL_EMAIL;
    const accessToken = process.env.SYSTEM_GMAIL_ACCESS_TOKEN;
    const refreshToken = process.env.SYSTEM_GMAIL_REFRESH_TOKEN;

    if (email && accessToken && refreshToken) {
      return { configured: true, email };
    }

    return { configured: false };
  }

  generateSystemAuthUrl(): string {
    const oauth2Client = this.getSystemOAuth2Client();

    const scopes = [
      'https://www.googleapis.com/auth/gmail.send',
      'https://www.googleapis.com/auth/userinfo.email',
    ];

    return oauth2Client.generateAuthUrl({
      access_type: 'offline',
      prompt: 'consent',
      scope: scopes,
      state: 'system',
    });
  }

  async handleSystemCallback(code: string) {
    const oauth2Client = this.getSystemOAuth2Client();
    const { tokens } = await oauth2Client.getToken(code);

    if (!tokens.access_token || !tokens.refresh_token) {
      throw new BadRequestException('Failed to obtain tokens from Google');
    }

    oauth2Client.setCredentials(tokens);
    const oauth2 = google.oauth2({ version: 'v2', auth: oauth2Client });
    const userinfo = await oauth2.userinfo.get();
    const email = userinfo.data.email;

    return {
      email,
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token,
      instructions:
        'Add these to your .env file:\n\nSYSTEM_GMAIL_EMAIL=' +
        email +
        '\nSYSTEM_GMAIL_ACCESS_TOKEN=' +
        tokens.access_token +
        '\nSYSTEM_GMAIL_REFRESH_TOKEN=' +
        tokens.refresh_token,
    };
  }

  private getOAuth2Client() {
    const clientId = process.env.GOOGLE_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
    const redirectUri = process.env.GOOGLE_REDIRECT_URI;

    if (!clientId || !clientSecret || !redirectUri) {
      throw new BadRequestException('Google OAuth credentials not configured');
    }

    return new OAuth2(clientId, clientSecret, redirectUri);
  }

  generateAuthUrl(userId: string): string {
    const oauth2Client = this.getOAuth2Client();

    const scopes = [
      'https://www.googleapis.com/auth/gmail.send',
      'https://www.googleapis.com/auth/userinfo.email',
    ];

    return oauth2Client.generateAuthUrl({
      access_type: 'offline',
      prompt: 'consent',
      scope: scopes,
      state: userId,
    });
  }

  async handleCallback(code: string, userId: string) {
    const oauth2Client = this.getOAuth2Client();

    const { tokens } = await oauth2Client.getToken(code);

    if (!tokens.access_token) {
      throw new BadRequestException(
        'Failed to obtain access token from Google',
      );
    }

    oauth2Client.setCredentials(tokens);

    // Get user email from OAuth2 userinfo endpoint
    const oauth2 = google.oauth2({ version: 'v2', auth: oauth2Client });
    const userinfo = await oauth2.userinfo.get();
    const email = userinfo.data.email;

    if (!email) {
      throw new BadRequestException('Failed to get email from Google profile');
    }

    const existingAccount = await this.prisma.clientEmailAccount.findUnique({
      where: { clientId: userId },
    });

    const refreshToken = tokens.refresh_token || existingAccount?.refreshToken;

    if (existingAccount) {
      return this.prisma.clientEmailAccount.update({
        where: { clientId: userId },
        data: {
          email,
          accessToken: tokens.access_token,
          refreshToken: refreshToken,
          provider: 'gmail',
          isActive: true,
        },
      });
    }

    if (!refreshToken) {
      throw new BadRequestException(
        'Failed to obtain refresh token. Please revoke access and try again.',
      );
    }

    return this.prisma.clientEmailAccount.create({
      data: {
        email,
        accessToken: tokens.access_token,
        refreshToken: refreshToken,
        provider: 'gmail',
        isActive: true,
        clientId: userId,
      },
    });
  }

  async disconnect(userId: string) {
    const account = await this.prisma.clientEmailAccount.findUnique({
      where: { clientId: userId },
    });

    if (!account) {
      throw new NotFoundException('Gmail account not connected');
    }

    if (account.accessToken) {
      try {
        const oauth2Client = this.getOAuth2Client();
        oauth2Client.setCredentials({ access_token: account.accessToken });
        await oauth2Client.revokeCredentials();
      } catch (error) {
        this.logger.warn('Failed to revoke Google credentials:', error.message);
      }
    }

    await this.prisma.clientEmailAccount.delete({
      where: { clientId: userId },
    });

    return { success: true, message: 'Gmail account disconnected' };
  }

  async getConnectionStatus(userId: string) {
    const account = await this.prisma.clientEmailAccount.findUnique({
      where: { clientId: userId },
      select: {
        email: true,
        isActive: true,
        pmolRecipientEmail: true,
        createdAt: true,
      },
    });

    if (!account) {
      return { connected: false };
    }

    return {
      connected: true,
      email: account.email,
      isActive: account.isActive,
      pmoRecipientEmail: account.pmolRecipientEmail,
      connectedAt: account.createdAt,
    };
  }

  async updatePmoRecipientEmail(userId: string, pmoEmail: string) {
    if (process.env.NODE_ENV === 'production') {
      throw new BadRequestException(
        'PMO email configuration is not available in production',
      );
    }

    const account = await this.prisma.clientEmailAccount.findUnique({
      where: { clientId: userId },
    });

    if (!account) {
      throw new NotFoundException('Gmail account not connected');
    }

    return this.prisma.clientEmailAccount.update({
      where: { clientId: userId },
      data: { pmolRecipientEmail: pmoEmail },
    });
  }

  async sendPmoEmail(
    userId: string,
    subject: string,
    body: string,
    bookingId?: string,
    cc?: string,
  ): Promise<{ success: boolean; messageId?: string; error?: string }> {
    // In production, use hardcoded PMO emails
    const isDev = process.env.NODE_ENV !== 'production';
    const recipients = isDev
      ? []
      : [
          'ACQUA PMO <pmo@acqua-residences.com>',
          'ACQUA Concierge Executive <concierge@acqua-residences.com>',
        ];

    // In dev, check for configured PMO email
    if (isDev) {
      const account = await this.prisma.clientEmailAccount.findUnique({
        where: { clientId: userId },
      });
      if (account?.pmolRecipientEmail) {
        recipients.push(account.pmolRecipientEmail);
      }
    }

    return this.sendEmail(userId, recipients, subject, body, bookingId, cc);
  }

  async sendEmail(
    userId: string,
    to: string | string[],
    subject: string,
    body: string,
    bookingId?: string,
    cc?: string,
  ): Promise<{ success: boolean; messageId?: string; error?: string }> {
    const account = await this.prisma.clientEmailAccount.findUnique({
      where: { clientId: userId },
    });

    if (!account) {
      throw new NotFoundException('Gmail account not connected');
    }

    if (!account.accessToken || !account.refreshToken) {
      throw new BadRequestException('Gmail tokens not available');
    }

    const recipients = Array.isArray(to) ? to : [to];

    // Create email log
    const emailLog = await this.emailLogService.createLog({
      userId,
      fromEmail: account.email,
      recipientEmail: recipients.join(', '),
      subject,
      body,
      bookingId,
    });

    const oauth2Client = this.getOAuth2Client();
    oauth2Client.setCredentials({
      access_token: account.accessToken,
      refresh_token: account.refreshToken,
    });

    const gmail = google.gmail({ version: 'v1', auth: oauth2Client });

    try {
      const results: string[] = [];
      for (const recipient of recipients) {
        const rawEmail = this.createRawEmail(
          account.email,
          recipient,
          subject,
          body,
          cc,
        );

        const response = await gmail.users.messages.send({
          userId: 'me',
          requestBody: {
            raw: rawEmail,
          },
        });

        if (response.data.id) {
          results.push(response.data.id);
        }
        this.logger.log(`PMO email sent from ${account.email} to ${recipient}`);
      }

      // Mark email log as sent
      await this.emailLogService.markAsSent(emailLog.id, results[0]);

      return {
        success: true,
        messageId: results[0],
      };
    } catch (error) {
      this.logger.error(`Failed to send PMO email: ${error.message}`);

      // Mark email log as failed
      await this.emailLogService.markAsFailed(emailLog.id, error.message);

      if (error.code === 401 || error.message?.includes('invalid')) {
        throw new BadRequestException(
          'Gmail authorization expired. Please reconnect your account.',
        );
      }

      throw new BadRequestException(`Failed to send email: ${error.message}`);
    }
  }

  private createRawEmail(
    from: string,
    to: string,
    subject: string,
    body: string,
    cc?: string,
  ): string {
    const message = [
      `From: ${from}`,
      `To: ${to}`,
      cc ? `Cc: ${cc}` : '',
      `Subject: ${subject}`,
      'Content-Type: text/html; charset=utf-8',
      '',
      body,
    ]
      .filter((line) => line !== '')
      .join('\r\n');

    return Buffer.from(message)
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
  }

  async sendPmoEmailTemplate(
    userId: string,
    templateType: 'BOOKING_CONFIRMATION' | 'PMO_REQUEST' | 'CUSTOM',
    variables?: Record<string, string>,
  ): Promise<{ success: boolean; messageId?: string; error?: string }> {
    const { subject, body } = this.getTemplate(templateType, variables);
    return this.sendPmoEmail(userId, subject, body);
  }

  private getTemplate(
    type: 'BOOKING_CONFIRMATION' | 'PMO_REQUEST' | 'CUSTOM',
    variables?: Record<string, string>,
  ): { subject: string; body: string } {
    const bookingDate = variables?.bookingDate || '[Date]';
    const slotNumber = variables?.slotNumber || '[Slot Number]';
    const tower = variables?.tower || '[Tower]';
    const startTime = variables?.startTime || '[Start Time]';
    const endTime = variables?.endTime || '[End Time]';

    const templates = {
      BOOKING_CONFIRMATION: {
        subject: `Temporary Guest Parking – ${tower} Slot ${slotNumber}`,
        body: `Hi,

Good day.

Please allow my guest to temporarily use my parking slot.

<strong>Parking Slot:</strong> ${tower} – Slot ${slotNumber}
<strong>Guest Name:</strong> ${variables?.guestName || '[Guest Name]'}

<strong>Schedule:</strong>
${bookingDate} – ${startTime}
${variables?.endDate || bookingDate} – ${endTime}

<strong>Tower & Unit:</strong> ${variables?.clientTower || 'N/A'} ${variables?.unitNumber || ''}

<strong>Vehicle Details:</strong>
Plate No.: ${variables?.plateNumber || 'N/A'}
Model/Color: ${variables?.vehicleModel || 'N/A'}${variables?.vehicleColor ? ` – ${variables.vehicleColor}` : ''}`,
      },
      PMO_REQUEST: {
        subject: `Temporary Guest Parking – ${tower} Slot ${slotNumber}`,
        body: `Hi,

Good day.

Please allow my guest to temporarily use my parking slot.

<strong>Parking Slot:</strong> ${tower} – Slot ${slotNumber}
<strong>Guest Name:</strong> ${variables?.guestName || '[Guest Name]'}

<strong>Schedule:</strong>
${bookingDate} – ${startTime}
${variables?.endDate || bookingDate} – ${endTime}

<strong>Tower & Unit:</strong> ${variables?.clientTower || 'N/A'} ${variables?.unitNumber || ''}

<strong>Vehicle Details:</strong>
Plate No.: ${variables?.plateNumber || 'N/A'}
Model/Color: ${variables?.vehicleModel || 'N/A'}${variables?.vehicleColor ? ` – ${variables.vehicleColor}` : ''}`,
      },
      CUSTOM: {
        subject: variables?.subject || 'PMO Communication',
        body: variables?.body || '<p>No content provided.</p>',
      },
    };

    return templates[type];
  }
}
