import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { EmailStatus } from '@prisma/client';

interface CreateEmailLogDto {
  userId?: string;
  fromEmail: string;
  recipientEmail: string;
  subject: string;
  body?: string;
  bookingId?: string;
}

export interface EmailLogWithUser {
  id: string;
  userId: string | null;
  fromEmail: string;
  recipientEmail: string;
  subject: string;
  body: string | null;
  status: EmailStatus;
  messageId: string | null;
  errorMessage: string | null;
  sentAt: Date | null;
  bookingId: string | null;
  createdAt: Date;
  user: {
    firstName: string;
    lastName: string;
    email: string;
  } | null;
}

@Injectable()
export class EmailLogService {
  private readonly logger = new Logger(EmailLogService.name);

  constructor(private prisma: PrismaService) {}

  async createLog(data: CreateEmailLogDto) {
    return this.prisma.emailLog.create({
      data: {
        userId: data.userId,
        fromEmail: data.fromEmail,
        recipientEmail: data.recipientEmail,
        subject: data.subject,
        body: data.body,
        bookingId: data.bookingId,
        status: EmailStatus.PENDING,
      },
    });
  }

  async markAsSent(emailLogId: string, messageId?: string) {
    return this.prisma.emailLog.update({
      where: { id: emailLogId },
      data: {
        status: EmailStatus.SENT,
        messageId: messageId,
        sentAt: new Date(),
      },
    });
  }

  async markAsFailed(emailLogId: string, errorMessage: string) {
    return this.prisma.emailLog.update({
      where: { id: emailLogId },
      data: {
        status: EmailStatus.FAILED,
        errorMessage: errorMessage,
      },
    });
  }

  async findAll(params: {
    skip?: number;
    take?: number;
    status?: EmailStatus;
    userId?: string;
    search?: string;
    startDate?: Date;
    endDate?: Date;
  }): Promise<{ data: EmailLogWithUser[]; total: number }> {
    const where: any = {};

    if (params.status) {
      where.status = params.status;
    }

    if (params.userId) {
      where.userId = params.userId;
    }

    if (params.search) {
      where.OR = [
        { subject: { contains: params.search, mode: 'insensitive' } },
        { recipientEmail: { contains: params.search, mode: 'insensitive' } },
        { fromEmail: { contains: params.search, mode: 'insensitive' } },
      ];
    }

    if (params.startDate || params.endDate) {
      where.createdAt = {};
      if (params.startDate) {
        where.createdAt.gte = params.startDate;
      }
      if (params.endDate) {
        where.createdAt.lte = params.endDate;
      }
    }

    const [data, total] = await Promise.all([
      this.prisma.emailLog.findMany({
        where,
        skip: params.skip,
        take: params.take,
        orderBy: { createdAt: 'desc' },
        include: {
          user: {
            select: {
              firstName: true,
              lastName: true,
              email: true,
            },
          },
        },
      }),
      this.prisma.emailLog.count({ where }),
    ]);

    return { data: data as EmailLogWithUser[], total };
  }

  async findOne(id: string): Promise<EmailLogWithUser | null> {
    return this.prisma.emailLog.findUnique({
      where: { id },
      include: {
        user: {
          select: {
            firstName: true,
            lastName: true,
            email: true,
          },
        },
      },
    }) as Promise<EmailLogWithUser | null>;
  }

  async getStats() {
    const [total, sent, failed, pending] = await Promise.all([
      this.prisma.emailLog.count(),
      this.prisma.emailLog.count({ where: { status: EmailStatus.SENT } }),
      this.prisma.emailLog.count({ where: { status: EmailStatus.FAILED } }),
      this.prisma.emailLog.count({ where: { status: EmailStatus.PENDING } }),
    ]);

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const sentToday = await this.prisma.emailLog.count({
      where: {
        status: EmailStatus.SENT,
        sentAt: { gte: today },
      },
    });

    return {
      total,
      sent,
      failed,
      pending,
      sentToday,
    };
  }
}
