-- CreateTable
CREATE TABLE "rating_settings" (
    "rating_settings_id" SERIAL NOT NULL,
    "current_scope_days" INTEGER NOT NULL,
    "yearly_scope_days" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "rating_settings_pkey" PRIMARY KEY ("rating_settings_id")
);
