'use client';

import Image from 'next/image';
import { useState } from 'react';
import { BarChart2, UsersRound } from '@/components/ui/icons';
import { UserAvatar } from '@/components/ui/UserAvatar';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { formatCount } from '@/lib/format-count';
import type { SharePreview } from '@/lib/sharing/presentation';

export function WorkspaceShareContents({preview,loading,trailingAction}:{preview:SharePreview;loading:boolean;trailingAction:boolean}) {
  const [failedImage,setFailedImage]=useState<string|null>(null);
  const identity=preview.state==='ready'?preview.identity:undefined,project=preview.state==='ready'?preview.project:undefined;
  const imageKey=JSON.stringify([identity?.avatarUrl,identity?.avatarRevision]);
  const image=identity?.avatarUrl && failedImage!==imageKey ? identity.avatarUrl : null;
  return <>
    <div className="flex min-w-0 items-start gap-3">
      {image?<Image key={identity?.avatarRevision ?? image} unoptimized src={image} alt="" width={54} height={54} onError={()=>setFailedImage(imageKey)} className="size-[54px] shrink-0 rounded-[3px] object-cover"/>:null}
      <div className={`min-w-0 flex-1 ${trailingAction?'pr-10':''}`}>
        {loading?<><div className="nb-skeleton h-4 w-4/5"/><div className="nb-skeleton mt-2 h-3 w-3/5"/></>:<><div dir="auto" className="nb-ui-label break-words font-semibold">{identity?.name??preview.title}</div><p dir="auto" className="nb-compact mt-1 break-words text-muted-foreground">{preview.description}</p></>}
      </div>
    </div>
    {project&&(Boolean(project.team?.length)||project.views!==null||project.followers!==null)?<div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2">
      {project.team?.length?<TooltipProvider delayDuration={200}><div className="flex -space-x-1.5" aria-label="Workspace team">
        {project.team.map(person=><Tooltip key={person.id}><TooltipTrigger asChild><span tabIndex={0} role="img" aria-label={`${person.name} · ${person.role}`} className="relative z-10 rounded-[5px] border-2 border-card bg-card outline-offset-2 focus-visible:outline-2 focus-visible:outline-primary"><UserAvatar key={person.avatarRevision} identity={{id:person.id,fullName:person.name,username:person.username,avatarUrl:person.avatarUrl}} size={28} unoptimized roundedClassName="rounded-[5px]"/></span></TooltipTrigger><TooltipContent className="max-w-64 break-words"><span dir="auto">{person.name}</span><span className="block text-xs">{person.role}</span></TooltipContent></Tooltip>)}
        {project.teamOverflow? <Tooltip><TooltipTrigger asChild><span tabIndex={0} role="img" aria-label={`${project.teamOverflow} more permitted team members`} className="relative z-10 grid size-8 place-items-center rounded-[5px] border-2 border-card bg-muted text-[10px] outline-offset-2 focus-visible:outline-2 focus-visible:outline-primary">+{project.teamOverflow}</span></TooltipTrigger><TooltipContent>Open the workspace to view the team.</TooltipContent></Tooltip>:null}
      </div></TooltipProvider>:null}
      {project.views!==null||project.followers!==null?<div className="flex flex-wrap gap-3 font-mono text-xs text-muted-foreground" aria-label="Workspace statistics">
        {([['views',project.views,BarChart2],['followers',project.followers,UsersRound]] as const).filter(([label,count])=>label!=='views'||count!==0).map(([label,count,Icon])=><span key={label} className="inline-flex items-center gap-1" title={count===null?`${label} unavailable`:`${count.toLocaleString('en-US')} ${label}`} aria-label={count===null?`${label} unavailable`:`${count.toLocaleString('en-US')} ${label}`}><Icon size={14} aria-hidden/>{count===null?'—':formatCount(count)} <span>{count===1?label.slice(0,-1):label}</span></span>)}
      </div>:null}
    </div>:null}
    {identity&&preview.skills.length?<div className="mt-3 flex flex-wrap gap-1.5" aria-label="Workspace skills">{preview.skills.map(skill=><span key={skill} dir="auto" className="nb-tag rounded-[3px] max-w-full [overflow-wrap:anywhere]">{skill}</span>)}{preview.skillOverflow?<span className="nb-tag rounded-[3px]" aria-label={`${preview.skillOverflow} more skills`}>+{preview.skillOverflow}</span>:null}</div>:null}
    {project?.roles?.length?<div className="mt-3"><div className="nb-micro text-muted-foreground">Open roles</div><div className="mt-1 flex flex-wrap gap-1.5" aria-label="Open role titles">{project.roles.slice(0,-1).map(role=><span key={role.id} className="nb-tag rounded-[3px] max-w-full [overflow-wrap:anywhere]" dir="auto">{role.title}</span>)}<span className="inline-flex max-w-full items-center gap-1.5"><span className="nb-tag rounded-[3px] max-w-full [overflow-wrap:anywhere]" dir="auto">{project.roles.at(-1)!.title}</span>{project.roleOverflow?<span className="nb-tag rounded-[3px]" aria-label={`${project.roleOverflow} more open roles`}>+{project.roleOverflow}</span>:null}</span></div><p className="nb-micro mt-1 text-muted-foreground">Open the workspace to check current availability.</p></div>:null}
    <div className="nb-meta mt-3 break-all" dir="ltr">{new URL(preview.url).hostname+new URL(preview.url).pathname}</div>
  </>;
}
