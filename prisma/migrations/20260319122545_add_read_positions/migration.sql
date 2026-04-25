-- CreateTable
CREATE TABLE "read_positions" (
    "user_id" TEXT NOT NULL,
    "scope_type" TEXT NOT NULL,
    "scope_id" TEXT NOT NULL,
    "last_read_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "read_positions_pkey" PRIMARY KEY ("user_id","scope_type","scope_id")
);

-- AddForeignKey
ALTER TABLE "read_positions" ADD CONSTRAINT "read_positions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
