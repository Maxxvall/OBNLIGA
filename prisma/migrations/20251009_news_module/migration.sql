-- CreateTable
CREATE TABLE "news" (
    "news_id" BIGSERIAL PRIMARY KEY,
    "title" VARCHAR(100) NOT NULL,
    "content" TEXT NOT NULL,
    "cover_url" TEXT,
    "send_to_telegram" BOOLEAN NOT NULL DEFAULT FALSE,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE INDEX "news_created_at_desc" ON "news" ("created_at" DESC);
