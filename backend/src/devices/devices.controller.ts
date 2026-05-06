import { Controller, Get, Param, Query } from '@nestjs/common';
import { DevicesService } from './devices.service';
import { QueryDeviceDto } from './dto/query-device.dto';

@Controller('devices')
export class DevicesController {
  constructor(private readonly devicesService: DevicesService) {}

  @Get()
  async findAll(@Query() query: QueryDeviceDto) {
    return this.devicesService.findAll(query);
  }

  @Get(':id')
  async findOne(@Param('id') id: string) {
    // Support both numeric ID and slug
    const numId = parseInt(id, 10);
    if (!isNaN(numId)) {
      return this.devicesService.findById(numId);
    }
    return this.devicesService.findBySlug(id);
  }
}
