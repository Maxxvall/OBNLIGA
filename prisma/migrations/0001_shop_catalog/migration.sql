-- Shop catalog and orders

-- CreateEnum
CREATE TYPE "ShopOrderStatus" AS ENUM ('PENDING', 'CONFIRMED', 'CANCELLED');

-- CreateTable
CREATE TABLE "shop_item" (
    "shop_item_id" SERIAL NOT NULL,
    "slug" TEXT,
    "title" VARCHAR(80) NOT NULL,
    "subtitle" VARCHAR(160),
    "description" TEXT,
    "price_cents" INTEGER NOT NULL,
    "currency_code" TEXT NOT NULL DEFAULT 'RUB',
    "stock_quantity" INTEGER,
    "max_per_order" INTEGER NOT NULL DEFAULT 3,
    "sort_order" INTEGER NOT NULL DEFAULT 100,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "image_url" TEXT,
    "image_data" BYTEA,
    "image_mime" TEXT,
    "image_width" INTEGER,
    "image_height" INTEGER,
    "image_size" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "shop_item_pkey" PRIMARY KEY ("shop_item_id"),
    CONSTRAINT "shop_item_slug_unique" UNIQUE ("slug")
);

-- CreateTable
CREATE TABLE "shop_order" (
    "shop_order_id" BIGSERIAL NOT NULL,
    "order_number" TEXT NOT NULL,
    "user_id" INTEGER,
    "telegram_id" BIGINT,
    "username" TEXT,
    "first_name" TEXT,
    "status" "ShopOrderStatus" NOT NULL DEFAULT 'PENDING',
    "total_cents" INTEGER NOT NULL,
    "currency_code" TEXT NOT NULL DEFAULT 'RUB',
    "customer_note" TEXT,
    "confirmed_at" TIMESTAMP(3),
    "confirmed_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "shop_order_pkey" PRIMARY KEY ("shop_order_id"),
    CONSTRAINT "shop_order_order_number_unique" UNIQUE ("order_number")
);

-- CreateTable
CREATE TABLE "shop_order_item" (
    "shop_order_item_id" BIGSERIAL NOT NULL,
    "order_id" BIGINT NOT NULL,
    "item_id" INTEGER NOT NULL,
    "title" VARCHAR(80) NOT NULL,
    "subtitle" VARCHAR(160),
    "price_cents" INTEGER NOT NULL,
    "quantity" INTEGER NOT NULL,
    "image_url" TEXT,

    CONSTRAINT "shop_order_item_pkey" PRIMARY KEY ("shop_order_item_id")
);

-- CreateIndex
CREATE INDEX "shop_item_active_order_idx" ON "shop_item" ("is_active", "sort_order");

-- CreateIndex
CREATE INDEX "shop_order_status_created_idx" ON "shop_order" ("status", "created_at");

-- CreateIndex
CREATE INDEX "shop_order_item_order_idx" ON "shop_order_item" ("order_id");

-- CreateIndex
CREATE INDEX "shop_order_item_item_idx" ON "shop_order_item" ("item_id");

-- AddForeignKey
ALTER TABLE "shop_order" ADD CONSTRAINT "shop_order_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "app_user"("user_id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shop_order_item" ADD CONSTRAINT "shop_order_item_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "shop_order"("shop_order_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shop_order_item" ADD CONSTRAINT "shop_order_item_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "shop_item"("shop_item_id") ON DELETE RESTRICT ON UPDATE CASCADE;
