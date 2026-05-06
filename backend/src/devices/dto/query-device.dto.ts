import { IsOptional, IsString, IsNumber, Min } from 'class-validator';

export class QueryDeviceDto {
  @IsOptional()
  @IsString()
  brand?: string; // brand slug e.g. 'apple', 'samsung'

  @IsOptional()
  @IsNumber()
  @Min(1)
  page?: number = 1;

  @IsOptional()
  @IsNumber()
  @Min(1)
  limit?: number = 6;

  @IsOptional()
  @IsString()
  search?: string;
}
