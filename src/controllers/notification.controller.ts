import { FastifyReply, FastifyRequest } from "fastify";
import { NotificationService } from "../services/notification.service.js";
import {
  CreateNotificationInput,
  BulkDispatchInput,
  NotificationFilterQuery,
} from "../schemas/notification.schema.js";

const service = new NotificationService();

export async function createNotificationHandler(
  request: FastifyRequest<{ Body: CreateNotificationInput }>,
  reply: FastifyReply,
) {
  const result = await service.dispatchSingle(request.body);
  return reply.status(202).send({
    message: "Notification accepted and queued for delivery",
    jobId: result.jobId,
    data: result.notification,
  });
}

export async function bulkDispatchHandler(
  request: FastifyRequest<{ Body: BulkDispatchInput }>,
  reply: FastifyReply,
) {
  const result = await service.dispatchBulk(request.body);
  return reply.status(202).send({
    message: "Bulk dispatch request accepted and queued",
    batchId: result.batchId,
    totalDispatched: result.totalDispatched,
    status: result.status,
  });
}

export async function listNotificationsHandler(
  request: FastifyRequest<{ Querystring: NotificationFilterQuery }>,
  reply: FastifyReply,
) {
  const result = await service.getNotifications(request.query);
  return reply.status(200).send(result);
}

export async function getNotificationByIdHandler(
  request: FastifyRequest<{ Params: { id: string } }>,
  reply: FastifyReply,
) {
  const { id } = request.params;
  const notification = await service.getNotificationById(id);

  if (!notification) {
    return reply.status(404).send({
      statusCode: 404,
      error: "Not Found",
      message: `Notification with id '${id}' not found`,
    });
  }

  return reply.status(200).send({ data: notification });
}

export async function getBatchStatusHandler(
  request: FastifyRequest<{ Params: { batchId: string } }>,
  reply: FastifyReply,
) {
  const { batchId } = request.params;
  const batch = await service.getBatchById(batchId);

  if (!batch) {
    return reply.status(404).send({
      statusCode: 404,
      error: "Not Found",
      message: `Batch dispatch with id '${batchId}' not found`,
    });
  }

  return reply.status(200).send({ data: batch });
}
