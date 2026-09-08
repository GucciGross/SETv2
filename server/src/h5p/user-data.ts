import type { IContentUserData, IContentUserDataStorage, IFinishedUserData, IUser } from '@lumieducation/h5p-server';
import { one, q } from '../db.js';

const stateColumns = `content_id AS "contentId", user_id AS "userId", data_type AS "dataType",
  sub_content_id AS "subContentId", context_id AS "contextId", user_state AS "userState", preload, invalidate`;
const finishedColumns = `content_id AS "contentId", user_id AS "userId", score, max_score AS "maxScore",
  opened_timestamp::float8 AS "openedTimestamp", finished_timestamp::float8 AS "finishedTimestamp", completion_time::float8 AS "completionTime"`;

/** One atomic PostgreSQL upsert per state; concurrent learners never rewrite a shared JSON file. */
export class PostgresUserData implements IContentUserDataStorage {
  constructor(private readonly spaceId: string) {}
  async createOrUpdateContentUserData(s: IContentUserData): Promise<void> {
    await q(`INSERT INTO h5p_user_state (space_id,content_id,user_id,data_type,sub_content_id,context_id,user_state,preload,invalidate)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
      ON CONFLICT (space_id,content_id,user_id,data_type,sub_content_id,context_id)
      DO UPDATE SET user_state=EXCLUDED.user_state,preload=EXCLUDED.preload,invalidate=EXCLUDED.invalidate,updated_at=now()`,
    [this.spaceId, s.contentId, s.userId, s.dataType, s.subContentId, s.contextId ?? '', s.userState, s.preload, s.invalidate]);
  }
  async getContentUserData(content: string, dataType: string, subContent: string, user: string, context = ''): Promise<IContentUserData> {
    // The upstream contract uses undefined for a state which has not been saved yet.
    return (await one<IContentUserData>(`SELECT ${stateColumns} FROM h5p_user_state WHERE space_id=$1 AND content_id=$2 AND data_type=$3 AND sub_content_id=$4 AND user_id=$5 AND context_id=$6`,
      [this.spaceId, content, dataType, subContent, user, context])) ?? undefined!;
  }
  getContentUserDataByContentIdAndUser(content: string, user: string, context = ''): Promise<IContentUserData[]> {
    return q(`SELECT ${stateColumns} FROM h5p_user_state WHERE space_id=$1 AND content_id=$2 AND user_id=$3 AND context_id=$4`, [this.spaceId, content, user, context]);
  }
  getContentUserDataByUser(user: IUser): Promise<IContentUserData[]> {
    return q(`SELECT ${stateColumns} FROM h5p_user_state WHERE space_id=$1 AND user_id=$2`, [this.spaceId, user.id]);
  }
  async deleteInvalidatedContentUserData(content: string): Promise<void> { await q('DELETE FROM h5p_user_state WHERE space_id=$1 AND content_id=$2 AND invalidate', [this.spaceId, content]); }
  async deleteAllContentUserDataByUser(user: IUser): Promise<void> { await q('DELETE FROM h5p_user_state WHERE space_id=$1 AND user_id=$2', [this.spaceId, user.id]); }
  async deleteAllContentUserDataByContentId(content: string): Promise<void> { await q('DELETE FROM h5p_user_state WHERE space_id=$1 AND content_id=$2', [this.spaceId, content]); }
  async createOrUpdateFinishedData(s: IFinishedUserData): Promise<void> {
    await q(`INSERT INTO h5p_finished (space_id,content_id,user_id,score,max_score,opened_timestamp,finished_timestamp,completion_time)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT (space_id,content_id,user_id)
      DO UPDATE SET score=EXCLUDED.score,max_score=EXCLUDED.max_score,opened_timestamp=EXCLUDED.opened_timestamp,
      finished_timestamp=EXCLUDED.finished_timestamp,completion_time=EXCLUDED.completion_time,updated_at=now()`,
    [this.spaceId, s.contentId, s.userId, s.score, s.maxScore, s.openedTimestamp, s.finishedTimestamp, s.completionTime]);
  }
  getFinishedDataByContentId(content: string): Promise<IFinishedUserData[]> { return q(`SELECT ${finishedColumns} FROM h5p_finished WHERE space_id=$1 AND content_id=$2`, [this.spaceId, content]); }
  getFinishedDataByUser(user: IUser): Promise<IFinishedUserData[]> { return q(`SELECT ${finishedColumns} FROM h5p_finished WHERE space_id=$1 AND user_id=$2`, [this.spaceId, user.id]); }
  async deleteFinishedDataByContentId(content: string): Promise<void> { await q('DELETE FROM h5p_finished WHERE space_id=$1 AND content_id=$2', [this.spaceId, content]); }
  async deleteFinishedDataByUser(user: IUser): Promise<void> { await q('DELETE FROM h5p_finished WHERE space_id=$1 AND user_id=$2', [this.spaceId, user.id]); }
}
