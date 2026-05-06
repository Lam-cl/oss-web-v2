import { Entity, PrimaryGeneratedColumn, Column, ManyToOne, JoinColumn, CreateDateColumn, UpdateDateColumn } from 'typeorm';
import { Brand } from '../brands/brand.entity';

@Entity('devices')
export class Device {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ length: 100, unique: true })
  slug: string;

  @Column({ length: 200 })
  name: string;

  @ManyToOne(() => Brand, (brand) => brand.devices, { eager: true })
  @JoinColumn({ name: 'brand_id' })
  brand: Brand;

  @Column({ name: 'brand_id' })
  brand_id: number;

  @Column({ length: 50, nullable: true })
  tag: string;

  @Column('decimal', { precision: 10, scale: 2 })
  rrp: number;

  @Column('decimal', { precision: 10, scale: 2 })
  monthly_price: number;

  @Column({ length: 500, nullable: true })
  image_url: string;

  @Column({ default: false })
  is_sold_out: boolean;

  @Column({ default: false })
  is_api_device: boolean;

  @Column({ length: 100, nullable: true })
  external_id: string;

  @Column({ default: 0 })
  sort_order: number;

  @Column({ default: true })
  is_active: boolean;

  @CreateDateColumn()
  created_at: Date;

  @UpdateDateColumn()
  updated_at: Date;
}
