-- CreateEnum
CREATE TYPE "ExpressStatus" AS ENUM ('PENDING', 'WON', 'LOST', 'CANCELLED', 'VOID');

-- CreateTable
CREATE TABLE "express_bet" (
    "express_bet_id" BIGSERIAL NOT NULL,
    "user_id" INTEGER NOT NULL,
    "status" "ExpressStatus" NOT NULL DEFAULT 'PENDING',
    "multiplier" DECIMAL(4,2) NOT NULL DEFAULT 1.0,
    "base_points" INTEGER NOT NULL,
    "score_awarded" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolved_at" TIMESTAMP(3),

    CONSTRAINT "express_bet_pkey" PRIMARY KEY ("express_bet_id")
);

-- CreateTable
CREATE TABLE "express_bet_item" (
    "express_bet_item_id" BIGSERIAL NOT NULL,
    "express_id" BIGINT NOT NULL,
    "template_id" BIGINT NOT NULL,
    "selection" TEXT NOT NULL,
    "status" "PredictionEntryStatus" NOT NULL DEFAULT 'PENDING',
    "base_points" INTEGER NOT NULL,
    "resolved_at" TIMESTAMP(3),

    CONSTRAINT "express_bet_item_pkey" PRIMARY KEY ("express_bet_item_id")
);

-- CreateIndex
CREATE INDEX "express_bet_user_status_idx" ON "express_bet"("user_id", "status");

-- CreateIndex
CREATE INDEX "express_bet_status_created_idx" ON "express_bet"("status", "created_at");

-- CreateIndex
CREATE INDEX "express_item_express_idx" ON "express_bet_item"("express_id");

-- CreateIndex
CREATE INDEX "express_item_template_status_idx" ON "express_bet_item"("template_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "express_item_unique" ON "express_bet_item"("express_id", "template_id");

-- AddForeignKey
ALTER TABLE "express_bet" ADD CONSTRAINT "express_bet_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "app_user"("user_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "express_bet_item" ADD CONSTRAINT "express_bet_item_express_id_fkey" FOREIGN KEY ("express_id") REFERENCES "express_bet"("express_bet_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "express_bet_item" ADD CONSTRAINT "express_bet_item_template_id_fkey" FOREIGN KEY ("template_id") REFERENCES "prediction_template"("prediction_template_id") ON DELETE CASCADE ON UPDATE CASCADE;
