import { OrgInformationFields } from '@/components/organizations/OrgWizardFields';
import { type ReactNode, useState } from 'react';
import { Controller, useFormContext, useWatch } from 'react-hook-form';
import { Plus, X } from 'lucide-react';
import { SkillPicker } from '@/components/skills/SkillPicker';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { POPULAR_PROJECT_TAGS, PROJECT_TYPE_OPTIONS } from '@/lib/projects/project-create-options';
import { CreateProjectInput } from '@/lib/validations/project';

type Phase2InformationProps = {
    showValidationSummary?: boolean;
};

const fieldLabelClass = 'mb-2 block text-[13px] font-medium leading-[1.2] text-foreground';
const fieldClass = 'h-[var(--ui-control-height-lg)] bg-card text-[15px]';
const textAreaClass = 'min-h-40 w-full resize-y rounded-md border border-input bg-card px-[var(--ui-control-px)] py-3 text-[15px] leading-[1.5] text-foreground outline-none transition-[border-color,box-shadow] placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30 aria-invalid:border-destructive aria-invalid:ring-2 aria-invalid:ring-destructive/20';
const projectTagLimit = 8;

function FieldError({ id, message }: { id: string; message?: string }) {
    if (!message) return null;

    return <p id={id} role="alert" className="mt-1.5 text-[13px] leading-[1.5] text-destructive">{message}</p>;
}

function TitleCount() {
    const title = useWatch<CreateProjectInput>({ name: 'title' }) || '';
    return <span className="nb-meta mb-2 shrink-0 text-muted-foreground">{title.length}/100</span>;
}

function TaglineCount() {
    const tagline = useWatch<CreateProjectInput>({ name: 'short_description' }) || '';
    return <span className="nb-meta mb-2 shrink-0 text-muted-foreground">{tagline.length}/200</span>;
}

function DescriptionCount() {
    const description = useWatch<CreateProjectInput>({ name: 'description' }) || '';
    return <span className="nb-meta mb-2 shrink-0 text-muted-foreground">{description.length}/5000</span>;
}

function FieldLabel({ htmlFor, children, required = false }: { htmlFor: string; children: ReactNode; required?: boolean }) {
    return (
        <label htmlFor={htmlFor} className={fieldLabelClass}>
            {children}
            {required ? <><span aria-hidden="true"> *</span><span className="sr-only"> (required)</span></> : null}
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

export default function Phase2Information({ showValidationSummary = false }: Phase2InformationProps) {
    const { register, setValue, watch, control, formState: { errors } } = useFormContext<CreateProjectInput>();
    const isOrganization = Boolean(watch('organization'));
    const [tagInput, setTagInput] = useState('');
    const [tagError, setTagError] = useState('');

    const tags = watch('tags') || [];
    const technologies = watch('technologies_used') || [];
    const projectType = watch('project_type');
    const selectedProjectType = PROJECT_TYPE_OPTIONS.find((type) => type.id === projectType);

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

    const removeTag = (tag: string) => {
        setValue('tags', tags.filter((item) => item !== tag), { shouldDirty: true, shouldValidate: true });
        setTagError('');
    };

    return (
        <div className="min-w-0 w-full space-y-8 pb-6">
            <div className="max-w-[65ch]">
                <p className="nb-micro text-primary">Phase 2 · information</p>
                <h2 className="nb-section-title mt-1 text-foreground">Project details</h2>
                <p className="nb-compact mt-1.5 text-muted-foreground">
                    Describe what you are building so collaborators can understand its purpose and find it later.
                </p>
            </div>

            {showValidationSummary && validationErrors.length > 0 ? (
                <div role="alert" aria-live="assertive" className="border-l-2 border-destructive bg-[var(--status-danger-soft)] px-4 py-3 text-[13px] leading-[1.5] text-foreground">
                    <p className="font-semibold">Check the required project details</p>
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

            <section aria-labelledby="project-identity-heading" className="border-t border-border pt-6">
                <SectionHeading
                    id="project-identity-heading"
                    eyebrow="Identity"
                    title="Name and classify the project"
                    description="Start with the information people see first when they encounter your project."
                />

                <div className="mt-5 space-y-5">
                    <div>
                        <FieldLabel htmlFor="create-project-category" required>Project category</FieldLabel>
                        <Controller
                            name="project_type"
                            control={control}
                            render={({ field }) => (
                                <Select value={field.value || ''} onValueChange={field.onChange}>
                                    <SelectTrigger
                                        id="create-project-category"
                                        ref={field.ref}
                                        onBlur={field.onBlur}
                                        className={`${fieldClass} bg-card text-[15px]`}
                                        aria-invalid={Boolean(errors.project_type)}
                                        aria-required="true"
                                        aria-describedby="create-project-category-help create-project-category-error"
                                    >
                                        <SelectValue placeholder="Select a category" />
                                    </SelectTrigger>
                                    <SelectContent>
                                        {PROJECT_TYPE_OPTIONS.map((type) => (
                                            <SelectItem key={type.id} value={type.id}>{type.label}</SelectItem>
                                        ))}
                                        <SelectItem value="other">Other</SelectItem>
                                    </SelectContent>
                                </Select>
                            )}
                        />
                        <p id="create-project-category-help" className="mt-1.5 text-[13px] leading-[1.5] text-muted-foreground">
                            {selectedProjectType?.description || (projectType === 'other' ? 'Use a category that is not represented in the list.' : 'Choose the format that best describes this work.')}
                        </p>
                        <FieldError id="create-project-category-error" message={errors.project_type?.message} />
                    </div>

                    {projectType === 'other' ? (
                        <div className="border-l-2 border-border pl-4">
                            <FieldLabel htmlFor="create-project-custom-category" required>Custom category</FieldLabel>
                            <Input
                                id="create-project-custom-category"
                                {...register('custom_project_type', {
                                    required: 'Custom category is required',
                                    minLength: { value: 2, message: 'Custom category must be at least 2 characters' },
                                    maxLength: { value: 50, message: 'Custom category must be less than 50 characters' },
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

                    <div>
                        <div className="flex items-end justify-between gap-3">
                            <FieldLabel htmlFor="create-project-title" required>Project title</FieldLabel>
                            <TitleCount />
                        </div>
                        <Input
                            id="create-project-title"
                            {...register('title')}
                            className={fieldClass}
                            placeholder="Name your project"
                            maxLength={100}
                            aria-invalid={Boolean(errors.title)}
                            aria-describedby="create-project-title-help create-project-title-error"
                            required
                        />
                        <p id="create-project-title-help" className="mt-1.5 text-[13px] leading-[1.5] text-muted-foreground">Use a clear, specific name that collaborators can recognize.</p>
                        <FieldError id="create-project-title-error" message={errors.title?.message} />
                    </div>

                    {isOrganization ? <OrgInformationFields /> : null}

                    <div>
                        <div className="flex items-end justify-between gap-3">
                            <FieldLabel htmlFor="create-project-tagline">Tagline</FieldLabel>
                            <TaglineCount />
                        </div>
                        <Input
                            id="create-project-tagline"
                            {...register('short_description')}
                            className={fieldClass}
                            placeholder="A short sentence that explains the project"
                            maxLength={200}
                            aria-describedby="create-project-tagline-help"
                        />
                        <p id="create-project-tagline-help" className="mt-1.5 text-[13px] leading-[1.5] text-muted-foreground">Optional. This appears beside the project name in compact contexts.</p>
                    </div>
                </div>
            </section>

            <section aria-labelledby="project-story-heading" className="border-t border-border pt-6">
                <SectionHeading
                    id="project-story-heading"
                    eyebrow="Project story"
                    title="Explain the work"
                    description="Give future collaborators enough context to decide whether the project is a fit."
                />

                <div className="mt-5 space-y-5">
                    <div>
                        <div className="flex items-end justify-between gap-3">
                            <FieldLabel htmlFor="create-project-description" required>Description</FieldLabel>
                            <DescriptionCount />
                        </div>
                        <textarea
                            id="create-project-description"
                            {...register('description')}
                            rows={6}
                            className={textAreaClass}
                            placeholder="Describe the problem, the project’s goals, and what a contributor should understand before joining."
                            maxLength={5000}
                            aria-invalid={Boolean(errors.description)}
                            aria-describedby="create-project-description-help create-project-description-error"
                            required
                        />
                        <p id="create-project-description-help" className="mt-1.5 max-w-[65ch] text-[13px] leading-[1.5] text-muted-foreground">A short, concrete explanation is more useful than a product pitch.</p>
                        <FieldError id="create-project-description-error" message={errors.description?.message} />
                    </div>

                    <div className="grid grid-cols-1 gap-6 border-t border-border pt-5 md:grid-cols-2">
                        <div>
                            <FieldLabel htmlFor="create-project-problem">Problem statement</FieldLabel>
                            <textarea
                                id="create-project-problem"
                                {...register('problem_statement')}
                                rows={4}
                                className={`${textAreaClass} min-h-32`}
                                placeholder="What problem are you solving?"
                            />
                        </div>
                        <div>
                            <FieldLabel htmlFor="create-project-solution">Solution overview</FieldLabel>
                            <textarea
                                id="create-project-solution"
                                {...register('solution_statement')}
                                rows={4}
                                className={`${textAreaClass} min-h-32`}
                                placeholder="How does this project address it?"
                            />
                        </div>
                    </div>
                </div>
            </section>

            <section aria-labelledby="project-discovery-heading" className="border-t border-border pt-6">
                <SectionHeading
                    id="project-discovery-heading"
                    eyebrow="Discovery"
                    title="Make the project easier to find"
                    description="Add concise topics and the skills people will use while contributing."
                />

                <div className="mt-5 space-y-6">
                    <div>
                        <div className="flex items-end justify-between gap-3">
                            <FieldLabel htmlFor="create-project-tag-input">Tags</FieldLabel>
                            <span className="nb-compact mb-2 shrink-0 text-muted-foreground" aria-live="polite">{tags.length}/{projectTagLimit}</span>
                        </div>
                        <p id="create-project-tags-help" className="mb-2 text-[13px] leading-[1.5] text-muted-foreground">Keyword tags used for search indexing and discovery filters (up to {projectTagLimit} tags).</p>
                        {tags.length > 0 ? (
                            <div className="mb-3 flex min-w-0 flex-wrap gap-2" aria-label="Selected tags">
                                {tags.map((tag) => (
                                    <span key={tag} className="inline-flex min-w-0 max-w-full items-center gap-1.5 rounded-[3px] border border-border bg-muted/60 px-2 py-0.5 font-mono text-[11px] uppercase tracking-[0.09em] text-foreground transition-colors hover:border-border/80">
                                        <span className="truncate">{tag}</span>
                                        <button type="button" className="text-muted-foreground opacity-70 transition-opacity hover:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30" onClick={() => removeTag(tag)} aria-label={`Remove ${tag}`}>
                                            <X className="size-3.5" aria-hidden="true" />
                                        </button>
                                    </span>
                                ))}
                            </div>
                        ) : null}
                        <div className="flex flex-col gap-2 sm:flex-row">
                            <Input
                                id="create-project-tag-input"
                                value={tagInput}
                                onChange={(event) => setTagInput(event.target.value)}
                                onKeyDown={(event) => {
                                    if (event.key === 'Enter') {
                                        event.preventDefault();
                                        addTag(tagInput);
                                    }
                                }}
                                className="h-[var(--ui-control-height-lg)] flex-1 text-[13px] leading-[1.5]"
                                placeholder="Add a topic, such as AI/ML or fintech"
                                aria-describedby="create-project-tags-help create-project-tags-error"
                                disabled={tags.length >= projectTagLimit}
                            />
                            <Button type="button" variant="outline" onClick={() => addTag(tagInput)} disabled={!tagInput.trim() || tags.length >= projectTagLimit} className="h-[var(--ui-control-height-lg)] shrink-0">
                                <Plus className="size-4" aria-hidden="true" />
                                Add tag
                            </Button>
                        </div>
                        {tagError ? <p id="create-project-tags-error" role="alert" className="mt-1.5 text-[13px] leading-[1.5] text-destructive">{tagError}</p> : null}
                        <div className="mt-3 flex flex-wrap gap-x-3 gap-y-1.5" aria-label="Suggested tags">
                            {POPULAR_PROJECT_TAGS.filter((tag) => !tags.some((item) => item.toLocaleLowerCase() === tag.toLocaleLowerCase())).slice(0, 5).map((tag) => (
                                <button
                                    key={tag}
                                    type="button"
                                    onClick={() => addTag(tag)}
                                    disabled={tags.length >= projectTagLimit}
                                    className="rounded-[3px] border border-border/60 bg-muted/40 px-2 py-0.5 font-mono text-[11px] uppercase tracking-[0.09em] text-muted-foreground transition hover:border-border hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30 disabled:cursor-not-allowed disabled:opacity-40"
                                >
                                    + {tag}
                                </button>
                            ))}
                        </div>
                    </div>

                    <div className="border-t border-border pt-5">
                        <SkillPicker
                            value={technologies}
                            onChange={(next) => setValue('technologies_used', next, { shouldDirty: true, shouldValidate: true })}
                            label="Project skills and technologies"
                            description="Search for the skills contributors will use."
                            compact
                            progressive
                            controlSize="large"
                            className="space-y-3"
                        />
                    </div>
                </div>
            </section>

        </div>
    );
}
