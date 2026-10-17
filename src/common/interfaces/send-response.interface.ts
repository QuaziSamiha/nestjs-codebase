import { IPaginationMeta } from '../../shared/pagination';

export interface IApiResponse<T> {
  statusCode: number;
  success: boolean;
  message?: string;
  data?: T;
  meta?: IPaginationMeta;
}
