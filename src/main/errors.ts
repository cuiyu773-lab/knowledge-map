export class AppError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly detail?: string
  ) {
    super(message)
  }
}
