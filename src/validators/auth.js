import { z } from 'zod';

export const loginSchema = z.object({
  body: z.object({
    email: z.string().email('Invalid email address'),
    password: z.string().min(8, 'Password must be at least 8 characters'),
  }),
});

export const signupSchema = z.object({
  body: z.object({
    name: z.string().min(1, 'Name is required').max(100),
    businessName: z.string().max(100).optional(),
    email: z.string().email('Invalid email address'),
    password: z.string().min(8, 'Password must be at least 8 characters'),
  }),
});

export const refreshTokenSchema = z.object({
  body: z.object({
    refreshToken: z.string().min(1, 'Refresh token is required'),
  }),
});

export const requestOtpSchema = z.object({
  body: z.object({
    virtualNumber: z.string().min(1, 'Virtual number is required'),
  }),
});

export const verifyOtpSchema = z.object({
  body: z.object({
    virtualNumber: z.string().min(1, 'Virtual number is required'),
    otp: z.string().length(6, 'OTP must be 6 digits'),
  }),
});