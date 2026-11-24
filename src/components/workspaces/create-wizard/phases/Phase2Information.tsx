import { CharCount } from "@/components/ui/CharCount";
import { OrgIdentityFields, OrgSubjectField, OrgWelcomeField } from '@/components/organizations/OrgWizardFields';
import { ORG_CREATION_COPY } from '@/lib/organizations/creation';
import { type ReactNode, useEffect, useState } from 'react';
import { Controller, useFormContext, useWatch } from 'react-hook-form';
import { Plus, X } from 'lucide-react';
import { SkillPicker } from '@/components/skills/SkillPicker';
import { Input } from '@/components/ui/input';
import { PhaseHead } from '../PhaseHead';
import { POPULAR_WORKSPACE_TAGS, WORKSPACE_TYPE_OPTIONS } from '@/lib/workspaces/workspace-create-options';
import { childTitleTakenAction } from '@/app/actions/organizations';
import { previewWorkspaceSlugAction } from '@/app/actions/workspace/slug-preview';
import { PixelTick } from '@/components/ui/PixelTick';
import { useLeaving } from '@/hooks/useLeaving';
import type { SourceFill } from '../useCreateWorkspaceWizard';
import { useCreateLocation } from '@/components/organizations/CreateLocation';
import { CreateWorkspaceInput } from '@/lib/validations/workspace';

type Phase2InformationProps = {
    showValidationSummary?: boolean;
    /** Filled from the repository's or folder's README on Start (create wizard v6), with Undo. */
    sourceFill?: SourceFill | null;
    onUndoSourceFill?: () => void;
};

// The categories most workspaces pick; the rest open with More (v6).
const COMMON_CATEGORIES = ['side_project', 'startup', 'open_source', 'learning', 'hackathon', 'web_app', 'tool'];

const fieldLabelClass = 'mb-2 block text-[13px] font-medium leading-[1.2] text-foreground';
const fieldClass = 'h-[var(--ui-control-height-lg)] bg-card text-[15px]';
const textAreaClass = 'min-h-40 w-full resize-y rounded-md border border-input bg-card px-[var(--ui-control-px)] py-3 text-[15px] leading-[1.5] text-foreground outline-none transition-[border-color,box-shadow] placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30 aria-invalid:border-destructive aria-invalid:ring-2 aria-invalid:ring-destructive/20';
const projectTagLimit = 8;

function FieldError({ id, message }: { id: string; message?: string }) {
    if (!message) return null;

    return <p id={id} role="alert" className="mt-1.5 text-[13px] leading-[1.5] text-destructive">{message}</p>;
}

function TitleCount() {
    const title = useWatch<CreateWorkspaceInput>({ name: 'title' }) || '';
    return <CharCount value={title.length} max={100} className="mb-2 shrink-0" />;
}

function TaglineCount() {
    const tagline = useWatch<CreateWorkspaceInput>({ name: 'short_description' }) || '';
    return <CharCount value={tagline.length} max={200} className="mb-2 shrink-0" />;
}

function DescriptionCount() {
    const description = useWatch<CreateWorkspaceInput>({ name: 'description' }) || '';
    return <CharCount value={description.length} max={5000} className="mb-2 shrink-0" />;
}

function FieldLabel({ htmlFor, children, required = false, from }: { htmlFor: string; children: ReactNode; required?: boolean; from?: string | false }) {
    return (
        <label htmlFor={htmlFor} className={fieldLabelClass}>
            {children}
            {required ? <><span aria-hidden="true"> *</span><span className="sr-only"> (required)</span></> : null}
            {from ? <span className="nbs-tag ok ml-2 align-[1px]">{from}</span> : null}
        </label>
    );
}

function SectionHeading({ eyebrow, title, description, id }: { eyebrow: string; title: string; description: string; id: string }) {
    return (
        <div className="max-w-[65ch]">
            <p className="nb-micro text-primary">{eyebrow}</p>
            <h3 id={id} className="nb-card-title mt-1 text-foreground">{title}</h3>
            <p className="nb-compact mt-1 text-muted-foreground">{description}</p>
        </div>
    );
}

export default function Phase2Information({ showValidationSummary = false, sourceFill = null, onUndoSourceFill }: Phase2InformationProps) {
    const { register, setValue, getValues, watch, control, formState: { errors } } = useFormContext<CreateWorkspaceInput>();
    const isOrganization = Boolean(watch('organization'));
    // Report §34.3: an organization's words and examples follow its type.
    const orgCopy = isOrganization ? ORG_CREATION_COPY[watch('organization.org_type') ?? 'other'] : null;
    // A child project (report §14.3 Phase 2): the org's category by default, its tags suggested first, and a
    // warning (never a block) when the title matches another project in the org.
    const { org } = useCreateLocation();
    const childTitle = watch('title') || '';
    const [titleTaken, setTitleTaken] = useState(false);
    useEffect(() => {
        if (org?.category && !watch('project_type') && WORKSPACE_TYPE_OPTIONS.some((type) => type.id === org.category)) {
            setValue('project_type', org.category as CreateWorkspaceInput['project_type'], { shouldDirty: true });
        }
    }, [org?.category, setValue, watch]);
    useEffect(() => {
        if (!org) return setTitleTaken(false);
        let cancelled = false;
        const timer = setTimeout(() => void childTitleTakenAction(org.id, childTitle).then((taken) => { if (!cancelled) setTitleTaken(taken); }), 400);
        return () => { cancelled = true; clearTimeout(timer); };
    }, [org, childTitle]);
    const suggestedTags = [...new Set([...(orgCopy?.topics ?? []), ...(org?.tags ?? []), ...POPULAR_WORKSPACE_TAGS])];
    const [tagInput, setTagInput] = useState('');
    const [tagError, setTagError] = useState('');

    // The address Create will give this name (v6): the plain name when free, else -2, -3 …
    const [address, setAddress] = useState<{ base: string; slug: string; taken: boolean } | null>(null);
    useEffect(() => {
        if (isOrganization || childTitle.trim().length < 1) { setAddress(null); return; }
        let cancelled = false;
        const timer = setTimeout(() => void previewWorkspaceSlugAction(childTitle).then((result) => {
            if (cancelled) return;
            setAddress(result);
            if (result) setValue('slug', result.slug);
        }).catch(() => undefined), 300);
        return () => { cancelled = true; clearTimeout(timer); };
    }, [childTitle, isOrganization, setValue]);
    const [allCategories, setAllCategories] = useState(false);
    const [storyOpen, setStoryOpen] = useState(false);
    // A filled field keeps its tag until someone changes it.
    const filled = (field: SourceFill['fields'][number]) => sourceFill?.fields.includes(field) && JSON.stringify(watch(field)) === JSON.stringify(sourceFill.values[field]) ? `from ${sourceFill.kind}` : false;

    const tags = watch('tags') || [];
    const technologies = watch('technologies_used') || [];
    const projectType = watch('project_type');

    const validationErrors = [
        errors.project_type?.message ? { id: 'create-project-category', message: errors.project_type.message } : null,
        errors.custom_project_type?.message ? { id: 'create-project-custom-category', message: errors.custom_project_type.message } : null,
        errors.title?.message ? { id: 'create-project-title', message: errors.title.message } : null,
        errors.description?.message ? { id: 'create-project-description', message: errors.description.message } : null,
    ].filter((item): item is { id: string; message: string } => Boolean(item));

    const addTag = (rawTag: string) => {
        const tag = rawTag.trim().replace(/\s+/g, ' ');
        if (!tag) return;
        if (tags.length >= projectTagLimit) {
            setTagError(`Tags can include up to ${projectTagLimit} items.`);
            return;
        }
        if (tags.some((existing) => existing.toLocaleLowerCase() === tag.toLocaleLowerCase())) {
            setTagInput('');
            return;
        }

        setValue('tags', [...tags, tag], { shouldDirty: true, shouldValidate: true });
        setTagInput('');
        setTagError('');
    };

    // A removed tag stays for its leave animation, then goes (v6.6 motion).
    const [isLeaving, leave] = useLeaving();
    const removeTag = (tag: string) => leave(tag, () => {
        setValue('tags', (getValues('tags') || []).filter((item) => item !== tag), { shouldDirty: true, shouldValidate: true });
        setTagError('');
    });

    return (
        <div className="min-w-0 w-full space-y-8 pb-6">
            <PhaseHead noun={orgCopy ? 'organization' : 'workspace'} step={orgCopy ? 'Details' : 'Info'} title="Name it, then explain it." line={orgCopy ? 'What people see first on its page and in search.' : 'What people see first on cards, search and the workspace header.'} />

            {showValidationSummary && validationErrors.length > 0 ? (
                <div role="alert" aria-live="assertive" className="nb-enter-reveal mt-6 bg-[var(--status-danger-soft)] px-4 py-3 text-[13px] leading-[1.5] text-foreground">
                    <p className="font-semibold">Check the required workspace details</p>
                    <ul className="mt-1 list-disc space-y-0.5 pl-4 text-muted-foreground">
                        {validationErrors.map((err) => (
                            <li key={err.id}>
                                <a
                                    href={`#${err.id}`}
                                    onClick={(e) => {
                                        e.preventDefault();
                                        const el = document.getElementById(err.id);
                                        el?.focus();
                                        el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
                                    }}
                                    className="underline underline-offset-2 hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                                >
                                    {err.message}
                                </a>
                            </li>
                        ))}
                    </ul>
                </div>
            ) : null}

            {sourceFill && sourceFill.fields.length ? (
                <div className="nb-srcnote" role="status">
                    <PixelTick className="text-[var(--status-success)]" />
                    <span>Filled from <b className="font-mono">{sourceFill.label}</b> (its README and package.json): {sourceFill.fields.map((f) => ({ title: 'name', short_description: 'summary', description: 'description', technologies_used: 'skills' })[f]).join(', ')}. Check them, then change anything.</span>
                    <button type="button" className="nb-link font-medium hover:underline" onClick={onUndoSourceFill}>Undo</button>
                </div>
            ) : null}

            <section aria-labelledby="project-identity-heading" className="nbs-frame">
                <p id="project-identity-heading" className="nbs-glabel pt-[18px]">Identity</p>
                <div className="nb-fld nb-fld-first">
                    <div className="flex items-end justify-between gap-3">
                        <FieldLabel htmlFor="create-project-title" required from={filled('title')}>{orgCopy ? 'Name' : 'Workspace name'}</FieldLabel>
                        <TitleCount />
                    </div>
                    <Input
                        id="create-project-title"
                        {...register('title')}
                        className={fieldClass}
                        placeholder={orgCopy?.name ?? 'Garden Map'}
                        maxLength={100}
                        aria-invalid={Boolean(errors.title)}
                        aria-describedby="create-project-title-help create-project-title-error"
                        required
                    />
                    <p id="create-project-title-help" data-address className="mt-1.5 text-[13px] leading-[1.5] text-muted-foreground">
                        {orgCopy ? 'The name members know it by.'
                            : !address ? 'A clear, specific name people will recognise.'
                            : address.taken ? <><span className="text-[var(--status-warning)]">networkbase.in/w/{address.base} is taken.</span> It gets <b className="font-mono font-medium text-foreground">networkbase.in/w/{address.slug}</b>, or change the name.</>
                            : <span className="inline-flex items-center gap-1.5 font-mono text-[12px]"><PixelTick className="text-[var(--status-success)]" />networkbase.in/w/{address.slug} · free</span>}
                    </p>
                    <FieldError id="create-project-title-error" message={errors.title?.message} />
                    {titleTaken && org ? <p role="status" className="mt-1.5 text-[13px] leading-[1.5] text-[var(--status-warning)]">Another workspace in {org.title} is already called this. You can keep it.</p> : null}
                </div>

                {orgCopy ? <div className="nb-fld"><OrgSubjectField /></div> : (
                    <>
                        <p className="nbs-glabel pt-4" id="create-project-category-label">Category<span className="r"><span className="nbs-tag">Required</span></span></p>
                        <Controller
                            name="project_type"
                            control={control}
                            render={({ field }) => {
                                const shown = allCategories ? WORKSPACE_TYPE_OPTIONS : WORKSPACE_TYPE_OPTIONS.filter((type) => COMMON_CATEGORIES.includes(type.id) || type.id === field.value);
                                const more = WORKSPACE_TYPE_OPTIONS.length - shown.length;
                                return (
                                    <div>
                                        <div id="create-project-category" role="radiogroup" aria-labelledby="create-project-category-label" aria-describedby="create-project-category-error" aria-invalid={Boolean(errors.project_type)} tabIndex={-1} className={`nb-choice-grid${errors.project_type ? ' nb-choice-bad' : ''}`}>
                                            {[...shown.map((type) => ({ id: type.id, label: type.label, hint: type.description })), { id: 'other', label: 'Other', hint: 'Name it yourself' }].map((option) => (
                                                <button key={option.id} type="button" role="radio" aria-checked={field.value === option.id} onClick={() => field.onChange(option.id)} className="nb-choice">
                                                    <b>{option.label}</b><span>{option.hint}</span>
                                                    {field.value === option.id ? <PixelTick className="nb-choice-tick" draw /> : null}
                                                </button>
                                            ))}
                                        </div>
                                        {!allCategories && more > 0 ? <button type="button" className="nb-more" onClick={() => setAllCategories(true)}>More categories <span className="font-mono text-[12px] text-muted-foreground">{more} more</span></button> : null}
                                    </div>
                                );
                            }}
                        />
                        <div className="nb-fld nb-fld-tight"><FieldError id="create-project-category-error" message={errors.project_type?.message} /></div>
                    </>
                )}

                {!orgCopy && projectType === 'other' ? (
                    <div className="nb-fld">
                        <FieldLabel htmlFor="create-project-custom-category" required>Name the category</FieldLabel>
                        <Input
                            id="create-project-custom-category"
                            {...register('custom_project_type', {
                                required: 'Enter a category',
                                minLength: { value: 2, message: 'Use at least 2 characters' },
                                maxLength: { value: 50, message: 'Use 50 characters or fewer' },
                            })}
                            className={fieldClass}
                            placeholder="For example, Research, hardware, or biotech"
                            aria-invalid={Boolean(errors.custom_project_type)}
                            aria-describedby="create-project-custom-category-error"
                            required
                        />
                        <FieldError id="create-project-custom-category-error" message={errors.custom_project_type?.message} />
                    </div>
                ) : null}

                <div className="nb-fld">
                    <div className="flex items-end justify-between gap-3">
                        <FieldLabel htmlFor="create-project-tagline" from={filled('short_description')}>{orgCopy ? 'Summary' : 'One-line summary'}</FieldLabel>
                        <TaglineCount />
                    </div>
                    <Input
                        id="create-project-tagline"
                        {...register('short_description')}
                        className={fieldClass}
                        placeholder={orgCopy?.tagline ?? 'Every plot, crop and volunteer day in town, on one map.'}
                        maxLength={200}
                        aria-describedby="create-project-tagline-help"
                    />
                    <p id="create-project-tagline-help" className="mt-1.5 text-[13px] leading-[1.5] text-muted-foreground">{orgCopy ? 'Optional. One line people see on cards and search results.' : 'Optional. Shows beside the name on cards.'}</p>
                </div>

                {orgCopy ? <div className="nb-fld"><OrgIdentityFields /></div> : null}
            </section>

            <section aria-labelledby="project-story-heading" className="nbs-frame">
                <p id="project-story-heading" className="nbs-glabel pt-[18px]">{orgCopy ? 'About' : 'Story'}</p>
                <div className="nb-fld nb-fld-first">
                    <div className="flex items-end justify-between gap-3">
                        <FieldLabel htmlFor="create-project-description" required from={filled('description')}>{orgCopy ? 'About' : 'Description'}</FieldLabel>
                        <DescriptionCount />
                    </div>
                    <textarea
                        id="create-project-description"
                        {...register('description')}
                        rows={6}
                        className={textAreaClass}
                        placeholder={orgCopy?.about ?? 'What it is, who it’s for, what a contributor should know first.'}
                        maxLength={5000}
                        aria-invalid={Boolean(errors.description)}
                        aria-describedby="create-project-description-help create-project-description-error"
                        required
                    />
                    <p id="create-project-description-help" className="mt-1.5 max-w-[65ch] text-[13px] leading-[1.5] text-muted-foreground">{orgCopy ? 'Shown first on the About tab.' : 'A short, concrete explanation is more useful than a product pitch.'}</p>
                    <FieldError id="create-project-description-error" message={errors.description?.message} />
                </div>

                {orgCopy || storyOpen || watch('problem_statement')?.trim() || watch('solution_statement')?.trim() ? (
                    <div className="nb-fld-two">
                        <div className="nb-fld">
                            <FieldLabel htmlFor="create-project-problem">{orgCopy ? "Who it’s for" : 'Problem'}</FieldLabel>
                            <textarea
                                id="create-project-problem"
                                {...register('problem_statement')}
                                rows={4}
                                className={`${textAreaClass} min-h-32`}
                                placeholder={orgCopy?.audience ?? 'What’s broken today?'}
                            />
                        </div>
                        <div className="nb-fld">
                            <FieldLabel htmlFor="create-project-solution">{orgCopy ? 'What members do here' : 'Approach'}</FieldLabel>
                            <textarea
                                id="create-project-solution"
                                {...register('solution_statement')}
                                rows={4}
                                className={`${textAreaClass} min-h-32`}
                                placeholder={orgCopy?.activities ?? 'How this fixes it.'}
                            />
                        </div>
                    </div>
                ) : (
                    <div className="nb-fld flex flex-wrap items-center gap-x-4 gap-y-1">
                        <button type="button" className="nb-link inline-flex items-center gap-1.5 font-medium hover:underline" onClick={() => { setStoryOpen(true); setTimeout(() => document.getElementById('create-project-problem')?.focus(), 0); }}>
                            <Plus className="size-3.5" aria-hidden="true" />Add problem and approach
                        </button>
                        <span className="text-[13px] text-muted-foreground">Optional. What’s broken today, and how this fixes it.</span>
                    </div>
                )}
                {orgCopy ? <div className="nb-fld"><OrgWelcomeField /></div> : null}
            </section>

            <section aria-labelledby="project-discovery-heading" className="nbs-frame">
                <p id="project-discovery-heading" className="nbs-glabel pt-[18px]">Discovery</p>
                <div className="nb-fld nb-fld-first">
                    <div className="flex items-end justify-between gap-3">
                        <FieldLabel htmlFor="create-project-tag-input">{orgCopy ? 'Topics' : 'Tags'}</FieldLabel>
                        <CharCount value={tags.length} max={projectTagLimit} className="mb-2 shrink-0" />
                    </div>
                    {/* One chip box (v6): chips and the input in the same field, suggestions under it. */}
                    <div className="nb-chipbox" aria-label="Selected tags">
                        {tags.map((tag) => (
                            <span key={tag} className="nb-tag nb-enter-chip" data-leaving={isLeaving(tag) || undefined}>
                                <span className="truncate">{tag}</span>
                                <button type="button" className="nb-chip-x" onClick={() => removeTag(tag)} aria-label={`Remove ${tag}`}>
                                    <X className="size-3" aria-hidden="true" />
                                </button>
                            </span>
                        ))}
                        {tags.length < projectTagLimit ? (
                            <input
                                id="create-project-tag-input"
                                value={tagInput}
                                onChange={(event) => setTagInput(event.target.value)}
                                onKeyDown={(event) => {
                                    if (event.key === 'Enter') {
                                        event.preventDefault();
                                        addTag(tagInput);
                                    }
                                }}
                                placeholder={tags.length ? 'Add another' : 'Add a topic, such as AI/ML or fintech'}
                                aria-describedby="create-project-tags-help create-project-tags-error"
                            />
                        ) : null}
                    </div>
                    {tagError ? <p id="create-project-tags-error" role="alert" className="mt-1.5 text-[13px] leading-[1.5] text-destructive">{tagError}</p> : null}
                    {tags.length < projectTagLimit ? (
                        <div className="mt-2.5 flex flex-wrap items-center gap-1.5" aria-label="Suggested tags">
                            <span className="nb-meta mr-1">suggested</span>
                            {suggestedTags.filter((tag) => !tags.some((item) => item.toLocaleLowerCase() === tag.toLocaleLowerCase())).slice(0, 5).map((tag) => (
                                <button key={tag} type="button" onClick={() => addTag(tag)} className="nb-tag-add">+ {tag}</button>
                            ))}
                        </div>
                    ) : null}
                    <p id="create-project-tags-help" className="mt-1.5 text-[13px] leading-[1.5] text-muted-foreground">Suggested from the category first. Up to {projectTagLimit}.</p>
                </div>

                {/* Organizations find people by topic; skills belong to the projects inside (decision 182). */}
                {orgCopy ? null : <div className="nb-fld">
                    {filled('technologies_used') ? <span className="nbs-tag ok mb-2">{filled('technologies_used')}</span> : null}
                    <SkillPicker
                        value={technologies}
                        onChange={(next) => setValue('technologies_used', next, { shouldDirty: true, shouldValidate: true })}
                        label="Skills contributors will use"
                        description="Search for the skills contributors will use."
                        compact
                        progressive
                        controlSize="large"
                        className="space-y-3"
                    />
                </div>}
            </section>

        </div>
    );
}
