// electron/services/knowledge/KnowledgeOrchestrator.ts

import path from 'path';
import fs from 'fs';
import { DocType } from './types';
import { extractSafeDocumentText } from '../SafeDocumentTextExtractor';
import { KnowledgeDatabaseManager } from './KnowledgeDatabaseManager';
import { ProfilePackBuilder } from './ProfilePackBuilder';
import { SettingsManager } from '../SettingsManager';
import { registerDynamicKeywords } from '../../utils/phoneticNormalizer';

export interface StructuredResumeData {
  identity: {
    name: string;
    email?: string;
    phone?: string;
    location?: string;
    linkedin?: string;
    github?: string;
    website?: string;
    title?: string;
    summary?: string;
    totalExperienceYears?: number;
  };
  skills: string[] | Record<string, string[]>;
  experience: Array<{
    company: string;
    role: string;
    start_date?: string;
    end_date?: string;
    duration?: string;
    location?: string;
    bullets: string[];
    technologies?: string[];
  }>;
  projects: Array<{
    name: string;
    description: string;
    technologies?: string[];
    role?: string;
    url?: string;
    architecture?: string;
    metrics?: string;
    highlights?: string[];
  }>;
  education: Array<{
    institution: string;
    degree: string;
    field?: string;
    start_date?: string;
    end_date?: string;
    gpa?: string;
  }>;
  certifications?: Array<{
    name: string;
    issuer?: string;
    date?: string;
  }>;
  achievements?: string[];
  selfIntro?: {
    short_30s?: string;
    full_90s?: string;
    spoken_pitch?: string;
  };
  _extraction_mode?: 'llm' | 'heuristic';
}

export class KnowledgeOrchestrator {
  private db: KnowledgeDatabaseManager;
  private knowledgeMode: boolean = true;
  public activeResume: any = null;
  public activeJD: any = null;

  private generateContentFn: ((contents: any[]) => Promise<string>) | null = null;
  private liveCoachingContentFn: ((contents: any[]) => Promise<string>) | null = null;
  private embedFn: ((text: string) => Promise<number[]>) | null = null;
  private embedWithMetadataFn: ((text: string) => Promise<any>) | null = null;
  private embedBatchWithMetadataFn: ((texts: string[]) => Promise<any[]>) | null = null;
  private activeSpaceFn: (() => string | undefined) | null = null;
  private embedQueryFn: ((text: string) => Promise<number[]>) | null = null;
  private fastQueryEmbedFn: ((text: string) => Promise<number[]>) | null = null;
  private searchProviderResolver: any = null;
  private companyResearchAllowedFn: (() => boolean) | null = null;
  private conversationContextProvider: (() => any) | null = null;

  constructor(db: KnowledgeDatabaseManager) {
    this.db = db;
    this.loadPersistedDocuments();
    try {
      const persistedMode = SettingsManager.getInstance().get('knowledgeMode');
      if (typeof persistedMode === 'boolean') {
        this.knowledgeMode = persistedMode;
      }
    } catch { /* ignore */ }
  }

  private extractKeywordsFromStructuredData(data: any): string[] {
    if (!data) return [];
    const keywords: string[] = [];

    // Identity
    if (data.identity?.name) keywords.push(data.identity.name);
    if (data.identity?.title) keywords.push(data.identity.title);

    // Skills
    if (Array.isArray(data.skills)) {
      keywords.push(...data.skills);
    } else if (data.skills && typeof data.skills === 'object') {
      for (const vals of Object.values(data.skills)) {
        if (Array.isArray(vals)) keywords.push(...vals);
      }
    }

    // Projects
    if (Array.isArray(data.projects)) {
      for (const p of data.projects) {
        if (p.name) keywords.push(p.name);
        if (Array.isArray(p.technologies)) keywords.push(...p.technologies);
      }
    }

    // Experience
    if (Array.isArray(data.experience)) {
      for (const e of data.experience) {
        if (e.company) keywords.push(e.company);
        if (e.role) keywords.push(e.role);
        if (Array.isArray(e.technologies)) keywords.push(...e.technologies);
      }
    }

    return keywords.filter(Boolean);
  }

  private loadPersistedDocuments(): void {
    try {
      const resumeDoc = this.db.getActiveDocument(DocType.RESUME);
      if (resumeDoc) {
        this.activeResume = resumeDoc;
        const kw = this.extractKeywordsFromStructuredData(resumeDoc.structured_data);
        registerDynamicKeywords(kw);
        console.log(`[KnowledgeOrchestrator] Restored active resume for: ${resumeDoc.structured_data?.identity?.name || resumeDoc.file_name} (registered ${kw.length} dynamic keywords)`);
      }
      const jdDoc = this.db.getActiveDocument(DocType.JD);
      if (jdDoc) {
        this.activeJD = jdDoc;
        const kw = this.extractKeywordsFromStructuredData(jdDoc.structured_data);
        registerDynamicKeywords(kw);
      }
    } catch (err) {
      console.error('[KnowledgeOrchestrator] Error loading persisted documents:', err);
    }
  }

  public setGenerateContentFn(fn: (contents: any[]) => Promise<string>): void {
    this.generateContentFn = fn;
  }
  public setLiveCoachingContentFn(fn: (contents: any[]) => Promise<string>): void {
    this.liveCoachingContentFn = fn;
  }
  public setEmbedFn(fn: (text: string) => Promise<number[]>): void {
    this.embedFn = fn;
  }
  public setEmbedWithMetadataFn(fn: (text: string) => Promise<any>): void {
    this.embedWithMetadataFn = fn;
  }
  public setEmbedBatchWithMetadataFn(fn: (texts: string[]) => Promise<any[]>): void {
    this.embedBatchWithMetadataFn = fn;
  }
  public setActiveSpaceFn(fn: () => string | undefined): void {
    this.activeSpaceFn = fn;
  }
  public setEmbedQueryFn(fn: (text: string) => Promise<number[]>): void {
    this.embedQueryFn = fn;
  }
  public setFastQueryEmbedFn(fn: (text: string) => Promise<number[]>): void {
    this.fastQueryEmbedFn = fn;
  }
  public setSearchProviderResolver(resolver: any): void {
    this.searchProviderResolver = resolver;
  }
  public setCompanyResearchAllowedFn(fn: () => boolean): void {
    this.companyResearchAllowedFn = fn;
  }
  public setConversationContextProvider(provider: () => any): void {
    this.conversationContextProvider = provider;
  }
  public attachRoleInsight(_sqliteDb: any): void {
    // Optional integration
  }
  public feedInterviewerUtterance(_text: string): void {
    // Live utterance tracking
  }

  public setKnowledgeMode(enabled: boolean): void {
    this.knowledgeMode = enabled;
  }

  public isKnowledgeMode(): boolean {
    return this.knowledgeMode;
  }

  public getStatus(): any {
    const resume = this.activeResume?.structured_data;
    const totalYoe = resume?.identity?.totalExperienceYears || (Array.isArray(resume?.experience) ? resume.experience.length * 2 : 0);
    return {
      hasResume: Boolean(this.activeResume),
      hasJD: Boolean(this.activeJD),
      activeMode: this.knowledgeMode,
      resumeSummary: this.activeResume ? {
        name: resume?.identity?.name || 'Candidate',
        role: resume?.identity?.title || resume?.experience?.[0]?.role || 'Software Engineer',
        totalExperienceYears: totalYoe,
      } : null,
    };
  }

  public feedForDepthScoring(_text: string): void {
    // Depth scoring tracking
  }

  public async processQuestion(message: string): Promise<any> {
    if (!this.knowledgeMode || !this.activeResume?.structured_data) {
      return null;
    }

    const resume = this.activeResume.structured_data;
    const msg = (message || '').trim();
    const isIntro = /(?:tell\s+me\s+about\s+yourself|introduce\s+yourself|walk\s+me\s+through\s+your\s+resume|who\s+are\s+you|give\s+(?:me\s+)?an?\s+intro|brief\s+intro|tell\s+me\s+who\s+you\s+are|about\s+you)/i.test(msg);
    // 1. "Tell me about yourself" / Self-Intro instant response
    if (isIntro) {
      const introText = this.generateSelfIntroScript(resume).spoken_pitch;
      return {
        isIntroQuestion: true,
        introResponse: introText,
        factualRecall: true,
      };
    }

    // 2. "Explain your projects" / Project breakdown instant response
    const isProjectExploration = /(?:explain\s+(?:me\s+)?(?:about\s+)?(?:your\s+)?projects?|tell\s+me\s+about\s+your\s+projects?|what\s+projects?\s+have\s+you\s+worked\s+on|describe\s+your\s+projects?|walk\s+me\s+through\s+your\s+projects?)/i.test(msg);
    if (isProjectExploration && Array.isArray(resume.projects) && resume.projects.length > 0) {
      const projectsText = (resume.projects || []).map((p: any, i: number) => {
        const techs = Array.isArray(p.technologies) ? p.technologies.join(', ') : '';
        const arch = p.architecture ? ` Architecture-wise, ${p.architecture}.` : '';
        const metrics = p.metrics ? ` Key achievement was ${p.metrics}.` : '';
        return `Project ${i + 1} is "${p.name}". Basically, ${p.description || ''}${arch}${metrics} Tech stack used includes ${techs}.`;
      }).join('\n\n');

      const instantProjectPitch = `Yeah, so basically, across my experience I've led key data engineering projects:\n\n${projectsText}\n\nAll of these were built focusing on high availability, data accuracy, and minimal latency.`;

      return {
        isIntroQuestion: true,
        introResponse: instantProjectPitch,
        factualRecall: true,
      };
    }

    // 3. "Previous experience" / Company history instant response
    const isCompanyExploration = /(?:explain\s+(?:about\s+)?(?:your\s+)?previous\s+experience|tell\s+me\s+about\s+your\s+experience|companies\s+you\s+worked|past\s+companies|work\s+history|where\s+did\s+you\s+work)/i.test(msg);
    if (isCompanyExploration && Array.isArray(resume.experience) && resume.experience.length > 0) {
      const historyText = resume.experience.map((e: any) => {
        const bullets = Array.isArray(e.bullets) ? e.bullets.slice(0, 2).join('. ') : '';
        return `At ${e.company} as a ${e.role} (${e.duration || `${e.start_date || ''} - ${e.end_date || 'Present'}`}): ${bullets}`;
      }).join('\n\n');

      const instantExpPitch = `Yeah, so coming to my work history:\n\n${historyText}\n\nOverall, I've worked across banking, healthcare, and financial data domains handling large-scale migrations and pipeline architectures.`;

      return {
        isIntroQuestion: true,
        introResponse: instantExpPitch,
        factualRecall: true,
      };
    }

    // 4. Pre-generated / ChatGPT Interview Q&A instant matcher
    if (Array.isArray(resume.interview_qa)) {
      const msgLower = msg.toLowerCase();
      const matchedQA = resume.interview_qa.find((item: any) => {
        if (!item || !item.answer) return false;
        if (item.question && msgLower.includes(item.question.toLowerCase())) return true;
        if (Array.isArray(item.keywords)) {
          return item.keywords.some((kw: string) => kw && msgLower.includes(kw.toLowerCase()));
        }
        return false;
      });

      if (matchedQA && matchedQA.answer) {
        return {
          isIntroQuestion: true,
          introResponse: matchedQA.answer,
          factualRecall: true,
        };
      }
    }

    // Identify if question is asking about candidate's background, projects, experience, or skills
    const isProfileQuery = /(?:project|projects|experience|work|company|role|responsibility|responsibilities|past|previous|career|background|skill|skills|tech\s+stack|technolog|resume|cv|portfolio|what\s+did\s+you\s+do|how\s+did\s+you\s+build|architecture)/i.test(msg);

    // Build rich XML evidence from parsed resume
    const identityName = resume.identity?.name || 'Candidate';
    const roleTitle = resume.identity?.title || resume.experience?.[0]?.role || 'Senior Data Engineer';
    const yoe = resume.identity?.totalExperienceYears || '5+';
    const summary = resume.identity?.summary || '';

    const expXml = (Array.isArray(resume.experience) ? resume.experience : []).map((exp: any) => {
      const bullets = (Array.isArray(exp.bullets) ? exp.bullets : []).map((b: string) => `    <bullet>${b}</bullet>`).join('\n');
      const techs = (Array.isArray(exp.technologies) ? exp.technologies : []).join(', ');
      return `  <job_experience>
    <company>${exp.company}</company>
    <role>${exp.role}</role>
    <duration>${exp.duration || `${exp.start_date || ''} - ${exp.end_date || 'Present'}`}</duration>
    <technologies>${techs}</technologies>
${bullets}
  </job_experience>`;
    }).join('\n');

    const projXml = (Array.isArray(resume.projects) ? resume.projects : []).map((p: any) => {
      const techs = (Array.isArray(p.technologies) ? p.technologies : []).join(', ');
      const highlights = (Array.isArray(p.highlights) ? p.highlights : []).map((h: string) => `    <highlight>${h}</highlight>`).join('\n');
      return `  <candidate_project>
    <name>${p.name}</name>
    <description>${p.description || ''}</description>
    <architecture>${p.architecture || ''}</architecture>
    <technologies>${techs}</technologies>
    <metrics>${p.metrics || ''}</metrics>
${highlights}
  </candidate_project>`;
    }).join('\n');

    const skillsXml = Array.isArray(resume.skills)
      ? resume.skills.join(', ')
      : typeof resume.skills === 'object'
        ? Object.entries(resume.skills).map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(', ') : v}`).join(' | ')
        : 'AWS, Spark, PostgreSQL, Python';

    const candidateProfileBlock = `<candidate_profile_facts source="uploaded_resume" trust="high">
  <identity>
    <name>${identityName}</name>
    <title>${roleTitle}</title>
    <years_of_experience>${yoe}</years_of_experience>
    <summary>${summary}</summary>
  </identity>
  <skills>${skillsXml}</skills>
  <experience_history>
${expXml}
  </experience_history>
  <featured_projects>
${projXml}
  </featured_projects>
</candidate_profile_facts>`;

    const voiceDirective = `You are ${identityName}, answering directly as the candidate in first-person ("I", "my team", "in our pipeline").
Speak naturally in conversational Indian English / Butler English with spoken confidence and natural fillers ("Yeah, so basically...", "Like, in our project...", "Means, coming to the architecture...").
Ground ALL answers in the candidate's actual resume facts, projects, technologies, and achievements above. Never fabricate company names or metrics outside the candidate profile facts.`;

    return {
      isIntroQuestion: false,
      factualRecall: isProfileQuery,
      systemPromptInjection: `${candidateProfileBlock}\n\n${voiceDirective}`,
      contextInjection: candidateProfileBlock,
    };
  }

  public getProfileData(): any {
    if (!this.activeResume) return null;
    return {
      ...this.activeResume.structured_data,
      activeResume: {
        id: this.activeResume.id,
        filename: this.activeResume.file_name,
        source_uri: this.activeResume.source_uri,
      },
    };
  }

  /**
   * Ingest a resume or JD file, parse full content, extract structured data,
   * build spoken introductions and project highlights, persist, and index OKF cards.
   */
  public async ingestDocument(filePath: string, docType: DocType = DocType.RESUME): Promise<{ success: boolean; error?: string; data?: any }> {
    try {
      console.log(`[KnowledgeOrchestrator] Starting ingestion for ${docType}: ${filePath}`);
      const extractResult = await extractSafeDocumentText(filePath);
      const rawText = extractResult.content;
      const fileName = extractResult.fileName;

      if (!rawText || !rawText.trim()) {
        return { success: false, error: 'Could not extract text from document.' };
      }

      let structuredData: any = null;

      // 1. Attempt deep LLM extraction if LLM is available
      if (this.generateContentFn) {
        try {
          structuredData = await this.extractStructuredWithLLM(rawText, docType);
        } catch (llmErr) {
          console.warn('[KnowledgeOrchestrator] LLM extraction failed, falling back to heuristic extraction:', llmErr);
        }
      }

      // 2. Fallback heuristic extraction
      if (!structuredData || !structuredData.identity?.name) {
        structuredData = this.extractStructuredHeuristically(rawText, fileName);
      }

      // 3. Ensure self-introduction is generated if not present
      if (docType === DocType.RESUME && (!structuredData.selfIntro || !structuredData.selfIntro.spoken_pitch)) {
        structuredData.selfIntro = this.generateSelfIntroScript(structuredData);
      }

      // 4. Persist to DB
      const docId = this.db.saveDocument({
        type: docType,
        source_uri: filePath,
        file_name: fileName,
        raw_text: rawText,
        structured_data: structuredData,
      });

      const docRecord = {
        id: docId,
        type: docType,
        source_uri: filePath,
        file_name: fileName,
        raw_text: rawText,
        structured_data: structuredData,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };

      if (docType === DocType.RESUME) {
        this.activeResume = docRecord;
        this.knowledgeMode = true;

        // 5. Ingest into ProfilePackBuilder for OKF cards & Vector RAG
        try {
          ProfilePackBuilder.getInstance().ingestStructuredProfile({
            kind: 'resume',
            docId,
            structuredData,
            totalExperienceYears: structuredData.identity?.totalExperienceYears,
          });
        } catch (packErr) {
          console.warn('[KnowledgeOrchestrator] ProfilePackBuilder generation note:', packErr);
        }
      } else {
        this.activeJD = docRecord;
        try {
          ProfilePackBuilder.getInstance().ingestStructuredProfile({
            kind: 'jd',
            docId,
            structuredData,
          });
        } catch (packErr) {
          console.warn('[KnowledgeOrchestrator] JD ProfilePackBuilder note:', packErr);
        }
      }

      console.log(`[KnowledgeOrchestrator] Successfully ingested ${docType} for: ${structuredData.identity?.name || fileName}`);
      return { success: true, data: structuredData };
    } catch (err: any) {
      console.error('[KnowledgeOrchestrator] ingestDocument error:', err);
      return { success: false, error: err?.message || 'Failed to ingest document' };
    }
  }

  private async extractStructuredWithLLM(text: string, docType: DocType): Promise<any> {
    const prompt = `You are a high-precision Resume & Career Information Parser.
Analyze the following document text and extract ALL details into a clean, valid JSON object.

Extract every company, position, project, technology stack, metric, accomplishment, and educational detail.
Also draft a 60-90 second natural spoken Self-Introduction ("Tell me about yourself") in conversational Butler/Indian English style with natural spoken fillers ("Yeah, so basically...", "Like, in our pipeline...", "Means, coming to my previous experience...").

Document Type: ${docType}
DOCUMENT TEXT:
${text.slice(0, 30000)}

Return ONLY a JSON object matching this schema with NO markdown wrapping or preamble:
{
  "identity": {
    "name": "Full Name",
    "email": "Email if found",
    "phone": "Phone if found",
    "location": "City, Country",
    "linkedin": "LinkedIn URL",
    "github": "GitHub URL",
    "title": "Current or primary professional title (e.g. Senior Data Engineer)",
    "summary": "2-3 sentence executive summary of background",
    "totalExperienceYears": 5
  },
  "skills": {
    "languages": ["Python", "SQL", "Scala", "Java"],
    "big_data_cloud": ["AWS Glue", "EMR", "Spark", "Apache Iceberg", "AWS DMS", "S3", "Athena", "Kafka", "Airflow"],
    "databases": ["PostgreSQL", "MySQL", "Redshift", "Snowflake", "Redis"],
    "devops_tools": ["Docker", "Kubernetes", "Terraform", "CI/CD", "Git"]
  },
  "experience": [
    {
      "company": "Company Name",
      "role": "Job Title",
      "start_date": "YYYY-MM or Start Date",
      "end_date": "YYYY-MM or Present",
      "duration": "e.g. 2 years 4 months",
      "location": "City, State",
      "bullets": [
        "Led migration of 500TB PostgreSQL DB using AWS DMS CDC pipeline with zero data loss",
        "Optimized PySpark Iceberg workloads resolving data skew using AQE and salted partitioning"
      ],
      "technologies": ["AWS DMS", "PySpark", "Apache Iceberg", "PostgreSQL", "S3"]
    }
  ],
  "projects": [
    {
      "name": "Project Name",
      "description": "Comprehensive explanation of what the project does and its architectural design",
      "role": "Your role and specific responsibilities on this project",
      "architecture": "Architecture details (e.g., CDC from RDS -> DMS -> Kafka -> Spark -> Iceberg on S3)",
      "technologies": ["Tech1", "Tech2", "Tech3"],
      "metrics": "Quantifiable outcomes (e.g. reduced pipeline latency from 2 hours to 18 mins, saved $12k/month)",
      "highlights": ["Key technical win 1", "Key technical win 2"]
    }
  ],
  "education": [
    {
      "institution": "University / College Name",
      "degree": "B.Tech / B.E / B.S / M.S",
      "field": "Computer Science / Information Technology",
      "start_date": "Year",
      "end_date": "Year",
      "gpa": ""
    }
  ],
  "certifications": [
    { "name": "AWS Certified Solutions Architect", "issuer": "Amazon Web Services", "date": "2024" }
  ],
  "achievements": [
    "Key career awards, patents, or recognitions"
  ],
  "selfIntro": {
    "short_30s": "Quick 30-second elevator pitch",
    "spoken_pitch": "Yeah, so basically, I am [Name], working as a [Title] with [X] years of experience. Currently at [Company]..."
  },
  "interview_qa": [
    {
      "question": "What is the architecture of your recent project?",
      "keywords": ["architecture", "recent project", "pipeline design", "how did you build"],
      "answer": "Yeah, so basically in my recent project, we designed a pipeline starting from..."
    },
    {
      "question": "How did you handle data skew or bottleneck issues?",
      "keywords": ["data skew", "bottleneck", "slow", "optimization", "performance", "aqe"],
      "answer": "In our PySpark pipelines, whenever we noticed partition skew, we implemented salting keys and enabled Spark AQE..."
    },
    {
      "question": "Why are you looking for a change?",
      "keywords": ["looking for change", "why change", "switch", "leaving", "reason for leaving"],
      "answer": "Yeah, so basically I'm looking for new technical challenges where I can lead large-scale distributed cloud architecture and data platform initiatives..."
    },
    {
      "question": "What are your core technical strengths?",
      "keywords": ["strengths", "core skills", "tech stack", "technologies you know", "expertise"],
      "answer": "My primary technical strengths are PySpark, AWS/Azure cloud data services, Snowflake, and end-to-end CDC ETL/ELT pipelines..."
    }
  ]
}`;

    const rawResponse = await this.generateContentFn!([{ text: prompt }]);
    const cleaned = rawResponse
      .replace(/```json/gi, '')
      .replace(/```/g, '')
      .trim();

    const parsed = JSON.parse(cleaned);
    parsed._extraction_mode = 'llm';
    return parsed;
  }

  private extractStructuredHeuristically(text: string, fileName: string): StructuredResumeData {
    const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
    const firstLines = lines.slice(0, 10).join(' ');

    // Name extraction
    let name = lines[0] || path.basename(fileName, path.extname(fileName));
    if (name.length > 40 || /resume|curriculum|cv|profile/i.test(name)) {
      name = lines.find(l => l.length < 35 && !/@|http|resume|cv/i.test(l)) || 'Candidate';
    }

    // Email extraction
    const emailMatch = text.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/);
    const email = emailMatch ? emailMatch[0] : '';

    // Phone extraction
    const phoneMatch = text.match(/(?:\+?\d{1,3}[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/);
    const phone = phoneMatch ? phoneMatch[0] : '';

    // Extract skills keywords
    const commonSkills = [
      'Python', 'SQL', 'Spark', 'PySpark', 'AWS', 'AWS DMS', 'Glue', 'Athena', 'S3',
      'PostgreSQL', 'MySQL', 'Kafka', 'Apache Iceberg', 'Delta Lake', 'Airflow', 'Docker',
      'Kubernetes', 'Redshift', 'Snowflake', 'Scala', 'Java', 'Git', 'CI/CD', 'Terraform',
      'React', 'Node.js', 'TypeScript', 'Linux', 'Hadoop', 'Hive'
    ];
    const detectedSkills = commonSkills.filter(s => new RegExp(`\\b${s}\\b`, 'i').test(text));

    // Experience extraction chunks
    const expBlocks: Array<{ company: string; role: string; bullets: string[]; technologies: string[] }> = [];
    const expKeywords = /(?:experience|employment|work history|career history)/i;
    const projKeywords = /(?:projects|technical projects|key projects)/i;

    let currentSection = 'summary';
    const rawExperienceLines: string[] = [];
    const rawProjectLines: string[] = [];

    for (const line of lines) {
      if (expKeywords.test(line) && line.length < 40) {
        currentSection = 'experience';
        continue;
      } else if (projKeywords.test(line) && line.length < 40) {
        currentSection = 'projects';
        continue;
      } else if (/(?:education|academics|qualifications)/i.test(line) && line.length < 40) {
        currentSection = 'education';
        continue;
      } else if (/(?:skills|technical skills|technologies)/i.test(line) && line.length < 40) {
        currentSection = 'skills';
        continue;
      }

      if (currentSection === 'experience') {
        rawExperienceLines.push(line);
      } else if (currentSection === 'projects') {
        rawProjectLines.push(line);
      }
    }

    // Parse bullets
    const expBullets = rawExperienceLines.filter(l => l.startsWith('•') || l.startsWith('-') || l.startsWith('*') || l.length > 25);
    const projBullets = rawProjectLines.filter(l => l.startsWith('•') || l.startsWith('-') || l.startsWith('*') || l.length > 25);

    const structured: StructuredResumeData = {
      identity: {
        name,
        email,
        phone,
        title: 'Senior Data Engineer',
        summary: `${name} is an experienced professional with proven expertise in data pipelines, cloud architecture, and distributed systems.`,
        totalExperienceYears: 5,
      },
      skills: detectedSkills.length > 0 ? detectedSkills : ['AWS', 'Spark', 'Python', 'SQL', 'PostgreSQL', 'Kafka'],
      experience: [
        {
          company: 'Current Organization',
          role: 'Senior Data Engineer',
          start_date: '2021-01',
          end_date: 'Present',
          bullets: expBullets.slice(0, 6).map(b => b.replace(/^[-•*]\s*/, '')),
          technologies: detectedSkills.slice(0, 6),
        }
      ],
      projects: [
        {
          name: 'Real-Time & Batch Data Platform',
          description: projBullets.slice(0, 3).join(' ') || 'High-throughput data engineering pipeline handling multi-terabyte dataset ingestion, transformation, and analytics.',
          technologies: detectedSkills.slice(0, 5),
          architecture: 'CDC via AWS DMS -> S3 Data Lake -> Apache Spark / Iceberg -> Athena Analytics',
          highlights: projBullets.slice(0, 4).map(b => b.replace(/^[-•*]\s*/, '')),
        }
      ],
      education: [
        {
          institution: 'University',
          degree: 'Bachelor of Engineering / Technology',
          field: 'Computer Science & Engineering',
        }
      ],
      _extraction_mode: 'heuristic',
    };

    structured.selfIntro = this.generateSelfIntroScript(structured);
    return structured;
  }

  public generateSelfIntroScript(data: any): { short_30s: string; spoken_pitch: string } {
    const name = data.identity?.name || 'Candidate';
    const role = data.identity?.title || data.experience?.[0]?.role || 'Senior Data Engineer';
    const yoe = data.identity?.totalExperienceYears || '5+';
    
    // Extract formatted skills
    const skillsList = Array.isArray(data.skills)
      ? data.skills.slice(0, 8).join(', ')
      : typeof data.skills === 'object' && data.skills !== null
        ? Object.values(data.skills).flat().slice(0, 8).join(', ')
        : 'PySpark, AWS Glue, Azure Databricks, Snowflake, Apache Airflow';

    const companies = (Array.isArray(data.experience) ? data.experience : []).map((e: any) => e.company).filter(Boolean);
    const primaryCompany = companies[0] || 'my current company';
    const otherCompanies = companies.slice(1).join(' and ');

    const projects = Array.isArray(data.projects) ? data.projects : [];
    const p1 = projects[0]?.name ? `"${projects[0].name}"` : 'our core data platform';
    const p2 = projects[1]?.name ? `"${projects[1].name}"` : '';

    let projectsPitch = '';
    if (p1 && p2) {
      projectsPitch = `For example, I've built ${p1} involving end-to-end cloud ETL/ELT pipelines, and ${p2} using modern Lakehouse architectures with Snowflake and Databricks.`;
    } else if (p1) {
      projectsPitch = `For instance, in ${p1}, I designed and deployed scalable data pipelines and real-time processing architectures.`;
    }

    const companyHistoryPitch = otherCompanies
      ? `Currently working at ${primaryCompany}, and previously worked with ${otherCompanies}.`
      : `Currently working at ${primaryCompany}.`;

    const spoken_pitch = `Yeah, so basically, I am ${name}. I have around ${yoe} years of experience as a ${role}, primarily focusing on building scalable cloud data pipelines, distributed computing, and analytics platforms. ${companyHistoryPitch} In my career, ${projectsPitch} My core tech stack includes ${skillsList}. I'm very comfortable across the entire pipeline lifecycle—from ingestion and transformation to dimensional modeling and BI support. So yeah, that's a quick overview of my profile!`;

    const short_30s = `I am ${name}, a ${role} with ${yoe} years of experience across ${companies.join(', ') || 'top organizations'}, specializing in ${skillsList}.`;

    return { short_30s, spoken_pitch };
  }

  public deleteDocument(docType: DocType = DocType.RESUME): void {
    try {
      this.db.deleteDocuments(docType);
      if (docType === DocType.RESUME) {
        this.activeResume = null;
      } else {
        this.activeJD = null;
      }
      console.log(`[KnowledgeOrchestrator] Deleted document for ${docType}`);
    } catch (err) {
      console.error('[KnowledgeOrchestrator] deleteDocument error:', err);
    }
  }

  public deleteDocumentsByType(docType: unknown): void {
    const dt = docType === 'jd' || docType === DocType.JD ? DocType.JD : DocType.RESUME;
    this.deleteDocument(dt);
  }
}

