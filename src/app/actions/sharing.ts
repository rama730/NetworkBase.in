'use server';

import { requireChatUser, unauthorized, invalidInput, isUuid, chatFailure } from '@/lib/messaging/server';
import { sql } from 'drizzle-orm';
import { selectMessages } from '@/lib/messaging/queries';
import { sendAs } from '@/lib/messaging/send';
import { takeSendToken } from '@/lib/messaging/send-bucket';
import { readSharePreview } from '@/lib/sharing/read';
import { parseShareResource, shareOrigin } from '@/lib/sharing/presentation';
import { headers } from 'next/headers';
import { getWorkspaceAccessByIdentifier } from '@/lib/data/workspace-access';
import { getShareDestination } from '@/app/actions/sharing-destinations';

/** URL and note only. Never persists the sender's private preview snapshot. */
export async function sendSharedLink(input: { url: string; channelId: string; note: string; clientId: string; expectedSenderId: string; checkOnly?: boolean }) {
  const user = await requireChatUser();
  if (!user) return unauthorized;
  if (input?.expectedSenderId !== user.id) return unauthorized;
  if (!input || (input.checkOnly !== undefined && typeof input.checkOnly !== 'boolean') || !isUuid(input.channelId) || typeof input.url !== 'string' || input.url.length > 2048 || typeof input.note !== 'string' || input.note.length > 1000
    || typeof input.clientId !== 'string' || !input.clientId || input.clientId.length > 160) return invalidInput;
  if (!takeSendToken(user.id)) return { success: false as const, error: 'chat_rate_limited' };
  try {
    // A committed send can be acknowledged even after its profile URL changes. This read
    // still requires current conversation membership, and does not create/publish a message.
    const [receipt] = await selectMessages(user.id,input.channelId,
      sql`m.author_id = ${user.id}::uuid AND m.client_message_id = ${input.clientId}`,sql`m.channel_seq DESC`,1);
    if (receipt) return {success:true as const,message:receipt,receipt:'found' as const};
    const destination=await getShareDestination({channelId:input.channelId,expectedActorId:user.id});
    if(!destination.success)return destination;
    if(input.checkOnly)return destination.channel.is_member ? {success:true as const,receipt:'missing' as const} : {success:false as const,error:'chat_not_member'};
    if(!destination.channel.is_member||destination.channel.can_send!==true)return {success:false as const,error:destination.channel.send_disabled_reason==='blocked'?'chat_blocked':destination.channel.send_disabled_reason==='archived'?'chat_channel_archived':'chat_not_member'};
    // Next validates server-action Origin against Host. Production still uses the configured base.
    const origin = shareOrigin((await headers()).get('origin') ?? undefined);
    const preview = await readSharePreview(input.url, user.id,origin);
    if (!preview || preview.state !== 'ready') return { success: false as const, error: 'share_unavailable' };
    if (preview.url !== input.url) return { success: false as const, error: 'share_link_changed' };
    let link = preview.url;
    const resource = parseShareResource(preview.url,origin);
    if (resource?.kind === 'project') {
      const access = await getWorkspaceAccessByIdentifier(resource.identifier, user.id);
      if (!access.canRead || !access.project) return { success: false as const, error: 'share_unavailable' };
      // The readable label stays canonical; the stable project id survives a later slug change.
      link = `[${preview.url}](${new URL(`/workspaces/${access.project.id}`,preview.url).href})`;
    }
    return await sendAs(user, { channelId: input.channelId, clientId: input.clientId,
      // Leading with the shared link prevents a URL in the note from replacing its preview.
      body: [link, input.note.trim()].filter(Boolean).join('\n\n') }, null);
  } catch (error) { return chatFailure(error, 'share_link'); }
}

/** The expected actor is a consistency guard; authority still comes only from the session. */
export async function saveShareUsername(input: {username:string;expectedSenderId:string;expectedUpdatedAt?:string}) {
  const user = await requireChatUser();
  if (!user || input?.expectedSenderId !== user.id) return {success:false as const,error:'Your account changed. Return to your own profile to set its username.'};
  const {updateProfileAction} = await import('@/app/actions/profile');
  return updateProfileAction({username:input.username,expectedUpdatedAt:input.expectedUpdatedAt});
}
