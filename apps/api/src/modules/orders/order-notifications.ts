export interface OrderEmailMessage {
  to: string;
  subject: string;
  text: string;
}

export type SendOrderEmail = (message: OrderEmailMessage) => Promise<void>;

function formatSantiagoDateTime(date: Date): string {
  return new Intl.DateTimeFormat('es-CL', {
    dateStyle: 'long',
    timeStyle: 'short',
    timeZone: 'America/Santiago',
  }).format(date);
}

function formatClp(amount: bigint): string {
  return `$${amount.toLocaleString('es-CL')}`;
}

export function buildPrescriptionApprovedEmail(input: {
  to: string;
  orderNumber: string;
  totalClp: bigint;
  reservationExpiresAt: Date;
  origin: string;
}): OrderEmailMessage {
  const deadline = formatSantiagoDateTime(input.reservationExpiresAt);
  const total = formatClp(input.totalClp);
  return {
    to: input.to,
    subject: `Receta aprobada — Pedido ${input.orderNumber}`,
    text: [
      `Estimado/a,`,
      ``,
      `Tu receta para el pedido ${input.orderNumber} fue aprobada por el equipo de la Farmacia Comunitaria de Peñalolén.`,
      ``,
      `Resumen:`,
      `- Pedido: ${input.orderNumber}`,
      `- Total del pedido: ${total}`,
      `- Stock reservado hasta: ${deadline}`,
      ``,
      `Para consultar el estado de la solicitud, ingresa a ${input.origin}, inicia sesión con tu correo y abre la sección "Mis pedidos".`,
      `Si no se registra el pago antes de la fecha límite, la reserva vencerá automáticamente y los medicamentos volverán al inventario.`,
      ``,
      `Farmacia Comunitaria de Peñalolén`,
    ].join('\n'),
  };
}

export function buildPrescriptionRejectedEmail(input: {
  to: string;
  orderNumber: string;
  rejectionReason: string;
  origin: string;
}): OrderEmailMessage {
  return {
    to: input.to,
    subject: `Receta rechazada — Pedido ${input.orderNumber}`,
    text: [
      `Estimado/a,`,
      ``,
      `No pudimos aprobar la receta adjunta para tu pedido ${input.orderNumber}.`,
      ``,
      `Motivo informado por la farmacia:`,
      `${input.rejectionReason}`,
      ``,
      `El stock reservado para esta solicitud fue liberado. Si cuentas con una receta vigente y legible, puedes ingresar una nueva solicitud desde ${input.origin}.`,
      ``,
      `Farmacia Comunitaria de Peñalolén`,
    ].join('\n'),
  };
}
