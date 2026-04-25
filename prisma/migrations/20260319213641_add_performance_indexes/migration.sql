-- CreateIndex
CREATE INDEX "direct_conversations_participant_a_id_idx" ON "direct_conversations"("participant_a_id");

-- CreateIndex
CREATE INDEX "direct_conversations_participant_b_id_idx" ON "direct_conversations"("participant_b_id");

-- CreateIndex
CREATE INDEX "group_memberships_user_id_state_idx" ON "group_memberships"("user_id", "state");
