-- CreateTable
CREATE TABLE "ad_banner" (
    "ad_banner_id" BIGSERIAL PRIMARY KEY,
    "title" VARCHAR(80) NOT NULL,
    "subtitle" VARCHAR(160),
    "target_url" TEXT,
    "image_data" BYTEA NOT NULL,
    "image_mime" TEXT NOT NULL,
    "image_width" INTEGER NOT NULL,
    "image_height" INTEGER NOT NULL,
    "image_size" INTEGER NOT NULL,
    "display_order" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT TRUE,
    "starts_at" TIMESTAMPTZ,
    "ends_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- CreateIndex
CREATE INDEX "ad_banner_active_order" ON "ad_banner" ("is_active", "display_order", "updated_at");
