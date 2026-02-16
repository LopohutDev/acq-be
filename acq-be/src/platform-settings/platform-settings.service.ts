import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class PlatformSettingsService {
  constructor(private prisma: PrismaService) {}

  async getSettings() {
    let settings = await this.prisma.platformSettings.findFirst();

    if (!settings) {
      settings = await this.prisma.platformSettings.create({
        data: { requireAddressForParking: true },
      });
    }

    return {
      requireAddressForParking: settings.requireAddressForParking,
    };
  }

  async updateSettings(data: { requireAddressForParking?: boolean }) {
    let settings = await this.prisma.platformSettings.findFirst();

    if (!settings) {
      settings = await this.prisma.platformSettings.create({
        data: {
          requireAddressForParking: data.requireAddressForParking ?? true,
        },
      });
    } else {
      settings = await this.prisma.platformSettings.update({
        where: { id: settings.id },
        data: { requireAddressForParking: data.requireAddressForParking },
      });
    }

    return {
      requireAddressForParking: settings.requireAddressForParking,
    };
  }
}
