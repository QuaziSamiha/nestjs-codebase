export class OtpEntity {
  id!: number;
  code!: string; // The hashed version
  type!: string;
  identifier!: string;
  isUsed!: boolean;
  expiresAt!: Date;
  createdAt!: Date;

  // You can add logic here
  get isExpired(): boolean {
    return new Date() > this.expiresAt;
  }
}
