import {
  IsString,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  Min,
  ValidatorConstraint,
  ValidationOptions,
  Validate,
  ValidationArguments,
  ValidatorConstraintInterface,
} from 'class-validator';
import { Transform } from 'class-transformer';

@ValidatorConstraint({ name: 'hasPricing', async: false })
export class HasPricingConstraint implements ValidatorConstraintInterface {
  validate(value: any, args: ValidationArguments) {
    const object = args.object as CreateParkingDto;
    return !!object.pricePerHour || !!object.pricePerDay;
  }

  defaultMessage(args: ValidationArguments) {
    return 'Either price per hour or price per day must be provided';
  }
}

export class CreateParkingDto {
  @Validate(HasPricingConstraint)
  @IsString()
  @IsNotEmpty()
  tower: string;

  @IsString()
  @IsNotEmpty()
  slotNumber: string;

  @IsString()
  @IsOptional()
  address?: string;

  @IsString()
  @IsOptional()
  city?: string;

  @IsString()
  @IsOptional()
  zipCode?: string;

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

  @Transform(({ value }) =>
    value === '' || value === null || value === undefined
      ? undefined
      : parseFloat(value),
  )
  @IsNumber()
  @IsOptional()
  @Min(0)
  pricePerHour?: number;

  @Transform(({ value }) =>
    value === '' || value === null || value === undefined
      ? undefined
      : parseFloat(value),
  )
  @IsNumber()
  @IsOptional()
  @Min(0)
  pricePerDay?: number;

  @IsString()
  @IsOptional()
  ownerId?: string;
}
