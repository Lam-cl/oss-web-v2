import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn } from 'typeorm';

@Entity('orders')
export class Order {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ length: 50, unique: true })
  order_number: string;

  @Column({ length: 200, nullable: true })
  customer_name: string;

  @Column({ length: 200, nullable: true })
  customer_email: string;

  @Column({ length: 20, nullable: true })
  customer_phone: string;

  @Column({ length: 20, nullable: true })
  customer_ic: string;

  @Column('jsonb', { nullable: true })
  shipping_address: any;

  @Column('jsonb')
  items: any[];

  @Column('decimal', { precision: 10, scale: 2, nullable: true })
  subtotal: number;

  @Column('decimal', { precision: 10, scale: 2, default: 0 })
  shipping_cost: number;

  @Column('decimal', { precision: 10, scale: 2 })
  total: number;

  @Column({ length: 30, default: 'pending' })
  status: string;

  @Column({ length: 30, nullable: true })
  payment_method: string;

  @Column({ length: 100, nullable: true })
  payment_ref: string;

  @Column({ length: 50, nullable: true })
  promoter_id: string;

  @CreateDateColumn()
  created_at: Date;

  @UpdateDateColumn()
  updated_at: Date;
}
