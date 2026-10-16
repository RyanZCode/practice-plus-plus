ALTER TABLE learner_memories
  ADD COLUMN approval_source VARCHAR(20),
  ADD COLUMN approval_reason VARCHAR(1000),
  ADD CONSTRAINT learner_memories_approval_source_check
    CHECK (approval_source IS NULL OR approval_source IN ('AUTOMATIC', 'MANUAL'));

UPDATE learner_memories SET approval_source = 'MANUAL'
WHERE approval_state = 'APPROVED';

UPDATE learner_memories AS memory
SET approval_state = 'APPROVED',
    reviewed_at = CURRENT_TIMESTAMP,
    updated_at = CURRENT_TIMESTAMP,
    approval_source = 'AUTOMATIC',
    approval_reason = 'Automatic approval was enabled for existing suggestions with saved supporting evidence.'
WHERE approval_state = 'PENDING'
  AND EXISTS (
    SELECT 1 FROM learner_memory_evidence AS evidence
    WHERE evidence.memory_id = memory.id
      AND evidence.user_profile_id = memory.user_profile_id
  );
