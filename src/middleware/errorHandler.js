export const errorHandler = (err, req, res, next) => {
  console.error('Error:', err);

  if (err.name === 'ZodError') {
    return res.status(400).json({
      message: 'Validation failed',
      errors: err.errors.map(e => ({ field: e.path.join('.'), message: e.message })),
    });
  }

  if (err.name === 'ValidationError') {
    return res.status(422).json({
      message: 'Validation failed',
      errors: Object.keys(err.errors || {}).map((key) => ({
        field: key,
        message: err.errors[key].message,
      })),
    });
  }

  if (err.code === 11000) {
    const field = Object.keys(err.keyPattern || {})[0] || 'field';
    return res.status(409).json({ message: `${field} already exists`, code: 'DUPLICATE' });
  }

  if (err.statusCode) {
    return res.status(err.statusCode).json({
      message: err.message,
      code: err.code || undefined,
    });
  }

  res.status(500).json({ message: 'Internal server error' });
};

export class AppError extends Error {
  constructor(message, statusCode) {
    super(message);
    this.statusCode = statusCode;
    this.name = 'AppError';
  }
}

export const notFoundHandler = (req, res) => {
  res.status(404).json({ message: 'Route not found' });
};