import { api } from '../../lib/api';
export interface H5PActivity {
  id: string; spaceId: string; title: string; library: string | null;
  draftRevision: number; publishedRevision: number | null; hasUnpublishedChanges: boolean;
  archived: boolean; canEdit: boolean; updatedAt: string;
}
export interface Placement { kind: 'page' | 'notebook' | 'path'; id: string }
export interface ActivityList { activities: H5PActivity[]; total: number; canEdit: boolean; canInstall: boolean }
export interface StudioStatus { ready: boolean; canEdit: boolean; canInstall: boolean; installed: { machineName: string; title: string; majorVersion: number; minorVersion: number; patchVersion: number; usable: boolean; issues: string[] }[]; bundle: { ready: boolean; contentTypes: number; libraries: number; missing: string[]; sha256: string } }
export const studioPath = (spaceId: string, activityId?: string) => `/app/space/${spaceId}/h5p${activityId ? `/${activityId}` : ''}`;
export const activityApi = (id: string, suffix = '') => `/h5p/activities/${id}${suffix}`;
export const placementQuery = (placement?: Placement) => placement ? `kind=${placement.kind}&parentId=${encodeURIComponent(placement.id)}` : '';
export async function downloadActivity(activity: H5PActivity) {
  const response = await api.raw(activityApi(activity.id, '/export'));
  if (!response.ok) throw new Error((await response.json()).error ?? 'Export failed.');
  const url = URL.createObjectURL(await response.blob());
  const anchor = document.createElement('a'); anchor.href = url;
  anchor.download = `${activity.title.replace(/[^\w.-]+/g, '_').slice(0, 80) || 'activity'}.h5p`;
  anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}
