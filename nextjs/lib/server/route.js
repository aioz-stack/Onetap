import { ApiError } from './errors';

// Wraps a route handler so thrown errors become JSON responses.
export function route(handler) {
  return async (request, context) => {
    try {
      return await handler(request, context);
    } catch (err) {
      if (err instanceof ApiError) {
        return Response.json({ error: err.message, fields: err.fields }, { status: err.status });
      }
      if (err instanceof SyntaxError) return Response.json({ error: 'That request could not be read.' }, { status: 400 });
      console.error(err);
      return Response.json({ error: 'Something went wrong. Please try again.' }, { status: 500 });
    }
  };
}
