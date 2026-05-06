import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn } from 'typeorm';

@Entity('banners')
export class Banner {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ length: 200, nullable: true })
  title: string;

  @Column({ length: 500 })
  desktop_image: string;

  @Column({ length: 500 })
  mobile_image: string;

  @Column({ length: 500, nullable: true })
  link_url: string;

  @Column({ default: 0 })
  sort_order: number;

  @Column({ default: true })
  is_active: boolean;

  @CreateDateColumn()
  created_at: Date;
}
