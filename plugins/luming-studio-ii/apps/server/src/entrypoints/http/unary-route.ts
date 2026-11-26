import {
  create,
  toBinary,
  type DescMessage,
  type DescMethodUnary,
  type MessageInitShape,
  type MessageShape,
} from '@bufbuild/protobuf';
import { decodeRequest } from './request.js';

export interface HttpActor {
  readonly id: string;
}

export type ProtobufRoute = (actor: HttpActor, body: Uint8Array) => Uint8Array;
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
      const response = handle(actor, request);
      return toBinary(method.output, create(method.output, response));
    },
  ];
}
