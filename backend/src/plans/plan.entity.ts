import { Entity, PrimaryGeneratedColumn, Column } from 'typeorm';

@Entity('plans')
export class Plan {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ length: 20, unique: true })
  slug: string;

  @Column({ length: 50 })
  name: string;

  @Column({ length: 200, nullable: true })
  tagline: string;

  @Column('decimal', { precision: 10, scale: 2 })
  price: number;

  @Column('jsonb', { nullable: true })
  features: string[];

  @Column('jsonb', { nullable: true })
  sub_features: string[];

  @Column('jsonb', { nullable: true })
  extras: string[];

  @Column({ length: 100, nullable: true })
  dataplan: string;

  @Column({ length: 20, nullable: true })
  gradient: string;

  @Column({ default: 0 })
  sort_order: number;

  @Column({ default: true })
  is_active: boolean;
}
