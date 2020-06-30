// TypeScript Version: 3.7
import { Params, Paginated, Id, NullableId } from '@feathersjs/feathers';
import { AdapterService, ServiceOptions, InternalServiceMethods } from '@feathersjs/adapter-commons';

export interface OfflineServiceStore {
  [key: number]: any;
}

export interface OfflineServiceOptions extends ServiceOptions {
  store: OfflineServiceStore;
  startId: number;
  matcher?: (query: any) => any;
  sorter?: (sort: any) => any;
}

export class Service<T = any> extends AdapterService<T> implements InternalServiceMethods<T> {
  options: OfflineServiceOptions;
  store: OfflineServiceStore;

  constructor(config?: Partial<OfflineServiceOptions>);

  _find(params?: Params): Promise<T | T[] | Paginated<T>>;
  _get(id: Id, params?: Params): Promise<T>;
  _create(data: Partial<T> | Array<Partial<T>>, params?: Params): Promise<T | T[]>;
  _update(id: NullableId, data: T, params?: Params): Promise<T>;
  _patch(id: NullableId, data: Partial<T>, params?: Params): Promise<T>;
  _remove(id: NullableId, params?: Params): Promise<T>;
}

declare const init: ((config?: Partial<OfflineServiceOptions>) => Service);
export default init;
