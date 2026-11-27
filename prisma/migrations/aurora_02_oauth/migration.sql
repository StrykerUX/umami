-- CreateTable
CREATE TABLE "aurora_oauth_client" (
    "client_id" UUID NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "redirect_uris" TEXT[],
    "client_uri" VARCHAR(2048),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_used_at" TIMESTAMPTZ(6),

    CONSTRAINT "aurora_oauth_client_pkey" PRIMARY KEY ("client_id")
);

-- CreateTable
CREATE TABLE "aurora_oauth_code" (
    "code_id" UUID NOT NULL,
    "code_hash" VARCHAR(128) NOT NULL,
    "user_id" UUID NOT NULL,
    "client_id" UUID NOT NULL,
    "redirect_uri" VARCHAR(2048) NOT NULL,
    "scope" VARCHAR(200) NOT NULL,
    "resource" VARCHAR(2048) NOT NULL,
    "code_challenge" VARCHAR(128) NOT NULL,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "used_at" TIMESTAMPTZ(6),
    "grant_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "aurora_oauth_code_pkey" PRIMARY KEY ("code_id")
);

-- CreateTable
CREATE TABLE "aurora_oauth_grant" (
    "grant_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "client_id" UUID NOT NULL,
    "client_name" VARCHAR(255) NOT NULL,
    "scope" VARCHAR(200) NOT NULL,
    "resource" VARCHAR(2048) NOT NULL,
    "pwd_fingerprint" VARCHAR(128) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_used_at" TIMESTAMPTZ(6),
    "revoked_at" TIMESTAMPTZ(6),
    "revoked_reason" VARCHAR(50),

    CONSTRAINT "aurora_oauth_grant_pkey" PRIMARY KEY ("grant_id")
);

-- CreateTable
CREATE TABLE "aurora_oauth_token" (
    "token_id" UUID NOT NULL,
    "grant_id" UUID NOT NULL,
    "kind" VARCHAR(10) NOT NULL,
    "token_hash" VARCHAR(128) NOT NULL,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "used_at" TIMESTAMPTZ(6),
    "revoked_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "aurora_oauth_token_pkey" PRIMARY KEY ("token_id")
);

-- CreateIndex
CREATE INDEX "aurora_oauth_client_created_at_idx" ON "aurora_oauth_client"("created_at");

-- CreateIndex
CREATE UNIQUE INDEX "aurora_oauth_code_code_hash_key" ON "aurora_oauth_code"("code_hash");

-- CreateIndex
CREATE INDEX "aurora_oauth_code_expires_at_idx" ON "aurora_oauth_code"("expires_at");

-- CreateIndex
CREATE INDEX "aurora_oauth_grant_user_id_idx" ON "aurora_oauth_grant"("user_id");

-- CreateIndex
CREATE INDEX "aurora_oauth_grant_client_id_idx" ON "aurora_oauth_grant"("client_id");

-- CreateIndex
CREATE UNIQUE INDEX "aurora_oauth_token_token_hash_key" ON "aurora_oauth_token"("token_hash");

-- CreateIndex
CREATE INDEX "aurora_oauth_token_grant_id_idx" ON "aurora_oauth_token"("grant_id");

-- CreateIndex
CREATE INDEX "aurora_oauth_token_expires_at_idx" ON "aurora_oauth_token"("expires_at");

