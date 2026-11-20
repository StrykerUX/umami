-- CreateTable
CREATE TABLE "aurora_user_profile" (
    "user_id" UUID NOT NULL,
    "email" VARCHAR(320) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "aurora_user_profile_pkey" PRIMARY KEY ("user_id")
);

-- CreateTable
CREATE TABLE "aurora_invite" (
    "invite_id" UUID NOT NULL,
    "kind" VARCHAR(10) NOT NULL,
    "email" VARCHAR(320),
    "role" VARCHAR(20) NOT NULL,
    "token_hash" VARCHAR(64) NOT NULL,
    "max_uses" INTEGER NOT NULL DEFAULT 1,
    "uses" INTEGER NOT NULL DEFAULT 0,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "invited_by" UUID,
    "revoked_at" TIMESTAMPTZ(6),
    "last_sent_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "aurora_invite_pkey" PRIMARY KEY ("invite_id")
);

-- CreateTable
CREATE TABLE "aurora_password_reset" (
    "reset_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "token_hash" VARCHAR(64) NOT NULL,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "used_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "aurora_password_reset_pkey" PRIMARY KEY ("reset_id")
);

-- CreateTable
CREATE TABLE "aurora_workspace" (
    "workspace_id" UUID NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "slug" VARCHAR(100) NOT NULL,
    "kind" VARCHAR(20) NOT NULL,
    "color" VARCHAR(20),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "aurora_workspace_pkey" PRIMARY KEY ("workspace_id")
);

-- CreateTable
CREATE TABLE "aurora_client_type" (
    "client_type_id" UUID NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "aurora_client_type_pkey" PRIMARY KEY ("client_type_id")
);

-- CreateTable
CREATE TABLE "aurora_client" (
    "client_id" UUID NOT NULL,
    "workspace_id" UUID,
    "client_type_id" UUID,
    "name" VARCHAR(150) NOT NULL,
    "contact_emails" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "notes" VARCHAR(2000),
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "aurora_client_pkey" PRIMARY KEY ("client_id")
);

-- CreateTable
CREATE TABLE "aurora_website_meta" (
    "website_id" UUID NOT NULL,
    "workspace_id" UUID,
    "client_id" UUID,
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "aurora_website_meta_pkey" PRIMARY KEY ("website_id")
);

-- CreateTable
CREATE TABLE "aurora_report_schedule" (
    "schedule_id" UUID NOT NULL,
    "name" VARCHAR(150) NOT NULL,
    "scope" VARCHAR(20) NOT NULL,
    "scope_id" UUID,
    "frequency" VARCHAR(20) NOT NULL,
    "sections" JSONB NOT NULL,
    "recipients" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "include_client_contacts" BOOLEAN NOT NULL DEFAULT true,
    "timezone" VARCHAR(64) NOT NULL DEFAULT 'America/Mexico_City',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "next_run_at" TIMESTAMPTZ(6) NOT NULL,
    "last_run_at" TIMESTAMPTZ(6),
    "created_by" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "aurora_report_schedule_pkey" PRIMARY KEY ("schedule_id")
);

-- CreateTable
CREATE TABLE "aurora_report_run" (
    "run_id" UUID NOT NULL,
    "schedule_id" UUID NOT NULL,
    "period_start" TIMESTAMPTZ(6) NOT NULL,
    "period_end" TIMESTAMPTZ(6) NOT NULL,
    "prev_start" TIMESTAMPTZ(6) NOT NULL,
    "prev_end" TIMESTAMPTZ(6) NOT NULL,
    "snapshot" JSONB NOT NULL,
    "status" VARCHAR(20) NOT NULL,
    "error" VARCHAR(2000),
    "sent_to" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "sent_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "aurora_report_run_pkey" PRIMARY KEY ("run_id")
);

-- CreateTable
CREATE TABLE "aurora_monitor" (
    "website_id" UUID NOT NULL,
    "url" VARCHAR(2000) NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "timeout_ms" INTEGER NOT NULL DEFAULT 10000,
    "keyword" VARCHAR(200),
    "alert_emails" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "status" VARCHAR(20) NOT NULL DEFAULT 'unknown',
    "consecutive_failures" INTEGER NOT NULL DEFAULT 0,
    "last_checked_at" TIMESTAMPTZ(6),
    "last_change_at" TIMESTAMPTZ(6),
    "last_latency_ms" INTEGER,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "aurora_monitor_pkey" PRIMARY KEY ("website_id")
);

-- CreateTable
CREATE TABLE "aurora_uptime_check" (
    "check_id" BIGSERIAL NOT NULL,
    "website_id" UUID NOT NULL,
    "checked_at" TIMESTAMPTZ(6) NOT NULL,
    "ok" BOOLEAN NOT NULL,
    "status_code" INTEGER,
    "latency_ms" INTEGER,
    "error" VARCHAR(500),
    "region" VARCHAR(20),

    CONSTRAINT "aurora_uptime_check_pkey" PRIMARY KEY ("check_id")
);

-- CreateTable
CREATE TABLE "aurora_incident" (
    "incident_id" UUID NOT NULL,
    "website_id" UUID NOT NULL,
    "started_at" TIMESTAMPTZ(6) NOT NULL,
    "resolved_at" TIMESTAMPTZ(6),
    "cause" VARCHAR(500),
    "annotation_id" UUID,

    CONSTRAINT "aurora_incident_pkey" PRIMARY KEY ("incident_id")
);

-- CreateTable
CREATE TABLE "aurora_email_log" (
    "email_id" UUID NOT NULL,
    "kind" VARCHAR(30) NOT NULL,
    "to" TEXT[],
    "subject" VARCHAR(300) NOT NULL,
    "status" VARCHAR(20) NOT NULL,
    "provider_id" VARCHAR(100),
    "error" VARCHAR(1000),
    "html" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "aurora_email_log_pkey" PRIMARY KEY ("email_id")
);

-- CreateIndex
CREATE UNIQUE INDEX "aurora_user_profile_email_key" ON "aurora_user_profile"("email");

-- CreateIndex
CREATE UNIQUE INDEX "aurora_invite_token_hash_key" ON "aurora_invite"("token_hash");

-- CreateIndex
CREATE INDEX "aurora_invite_email_idx" ON "aurora_invite"("email");

-- CreateIndex
CREATE UNIQUE INDEX "aurora_password_reset_token_hash_key" ON "aurora_password_reset"("token_hash");

-- CreateIndex
CREATE INDEX "aurora_password_reset_user_id_idx" ON "aurora_password_reset"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "aurora_workspace_slug_key" ON "aurora_workspace"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "aurora_client_type_name_key" ON "aurora_client_type"("name");

-- CreateIndex
CREATE INDEX "aurora_client_workspace_id_idx" ON "aurora_client"("workspace_id");

-- CreateIndex
CREATE INDEX "aurora_client_client_type_id_idx" ON "aurora_client"("client_type_id");

-- CreateIndex
CREATE INDEX "aurora_website_meta_workspace_id_idx" ON "aurora_website_meta"("workspace_id");

-- CreateIndex
CREATE INDEX "aurora_website_meta_client_id_idx" ON "aurora_website_meta"("client_id");

-- CreateIndex
CREATE INDEX "aurora_report_schedule_active_next_run_at_idx" ON "aurora_report_schedule"("active", "next_run_at");

-- CreateIndex
CREATE INDEX "aurora_report_run_schedule_id_created_at_idx" ON "aurora_report_run"("schedule_id", "created_at");

-- CreateIndex
CREATE INDEX "aurora_uptime_check_website_id_checked_at_idx" ON "aurora_uptime_check"("website_id", "checked_at");

-- CreateIndex
CREATE INDEX "aurora_incident_website_id_started_at_idx" ON "aurora_incident"("website_id", "started_at");

-- CreateIndex
CREATE INDEX "aurora_email_log_kind_created_at_idx" ON "aurora_email_log"("kind", "created_at");

