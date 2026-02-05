import { IsEnum, IsString, IsOptional } from 'class-validator';

export enum ApprovalAction {
  APPROVE = 'APPROVE',
  REJECT = 'REJECT',
}

export class ApproveParkingDto {
  @IsEnum(ApprovalAction)
  action: ApprovalAction;

  @IsString()
  @IsOptional()
  rejectionReason?: string;
}

