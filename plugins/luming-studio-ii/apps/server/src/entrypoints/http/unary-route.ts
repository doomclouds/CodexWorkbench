import {
  create,
  toBinary,
  type DescMessage,
  type DescMethodUnary,
  type MessageInitShape,
  type MessageShape,
} from '@bufbuild/protobuf';
import { decodeRequest } from './request.js';
import type { SharingScope } from '../../modules/sharing/application/index.js';

export interface HttpActor {
  readonly id: string;
  readonly kind?: 'human' | 'agent';
  readonly feedbackAuthorId?: string;
  readonly guestScope?: SharingScope;
  readonly authorize?: (request: object) => void;
  readonly authorizeRead?: (boardId: string) => void;
}

export function canReadTrashedBoard(actor: HttpActor): boolean {
  return actor.kind !== 'agent' && actor.guestScope === undefined;
}

export type ProtobufRoute = (
  actor: HttpActor,
  body: Uint8Array,
) => Uint8Array | Promise<Uint8Array>;
export type RouteEntry = readonly [string, ProtobufRoute];

type RouteHandler<Input extends DescMessage, Output extends DescMessage> = (
  actor: HttpActor,
  request: MessageShape<Input>,
) => MessageInitShape<Output>;

export function unaryRoute<Input extends DescMessage, Output extends DescMessage>(
  method: DescMethodUnary<Input, Output>,
  handle: RouteHandler<Input, Output>,
): RouteEntry {
  const path = `/${method.parent.typeName}/${method.name}`;

  return [
    path,
    (actor, body) => {
      const request = decodeRequest(method.input, body);
      actor.authorize?.(request);
      const response = handle(actor, request);
      return toBinary(method.output, create(method.output, response));
    },
  ];
}

export function asyncUnaryRoute<Input extends DescMessage, Output extends DescMessage>(
  method: DescMethodUnary<Input, Output>,
  handle: (actor: HttpActor, request: MessageShape<Input>) => Promise<MessageInitShape<Output>>,
): RouteEntry {
  const path = `/${method.parent.typeName}/${method.name}`;

  return [
    path,
    async (actor, body) => {
      const request = decodeRequest(method.input, body);
      actor.authorize?.(request);
      const response = await handle(actor, request);

      return toBinary(method.output, create(method.output, response));
    },
  ];
}
