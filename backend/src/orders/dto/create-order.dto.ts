import { IsString, IsOptional, IsNumber, IsArray, ValidateNested } from 'class-validator';

export class CreateOrderDto {
  @IsString()
  customer_name: string;

  @IsString()
  customer_email: string;

  @IsString()
  customer_phone: string;

  @IsOptional()
  @IsString()
  customer_ic?: string;

  @IsOptional()
  shipping_address?: any;

  @IsArray()
  items: any[];

  @IsNumber()
  total: number;

  @IsOptional()
  @IsString()
  payment_method?: string;

  @IsOptional()
  @IsString()
  promoter_id?: string;

  @IsOptional()
  @IsString()
  payment_ref?: string;

  @IsOptional()
  @IsNumber()
  shipping?: number;
}
