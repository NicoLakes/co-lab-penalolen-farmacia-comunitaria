// Error de negocio con código HTTP para usar en servicios y rutas.
export class ErrorHttp extends Error {
  readonly statusCode: number;

  constructor(statusCode: number, message: string) {
    super(message);
    this.name = 'ErrorHttp';
    this.statusCode = statusCode;
  }
}
