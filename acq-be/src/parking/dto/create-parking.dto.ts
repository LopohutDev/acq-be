import {
  IsString,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  Min,
} from 'class-validator';
import { Transform } from 'class-transformer';

export class CreateParkingDto {
  @IsString()
  @IsNotEmpty()
  title: string;

  @IsString()
  @IsOptional()
  description?: string;

  @IsString()
  @IsNotEmpty()
  address: string;

  @IsString()
  @IsNotEmpty()
  city: string;

  @IsString()
  @IsNotEmpty()
  zipCode: string;

  @Transform(({ value }) =>
    value === '' || value === null || value === undefined
      ? undefined
      : parseFloat(value),
  )
  @IsNumber()
  @IsOptional()
  latitude?: number;

  @Transform(({ value }) =>
    value === '' || value === null || value === undefined
      ? undefined
      : parseFloat(value),
  )
  @IsNumber()
  @IsOptional()
  longitude?: number;

  @Transform(({ value }) => parseFloat(value))
  @IsNumber()
  @Min(0)
  pricePerHour: number;

  @IsString()
  @IsOptional()
  ownerId?: string;
}
