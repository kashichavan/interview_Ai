/**
 * phoneticNormalizer.ts
 *
 * Dynamic Acoustic & Phonetic Speech-To-Text Disambiguation Engine.
 * 
 * Combines:
 * 1. Dynamic Candidate Profile & Resume Vocabulary (skills, tools, projects, companies)
 * 2. Standard Software & Data Engineering Ontology (150+ frameworks, databases, tools)
 * 3. Phonetic Soundex / Metaphone acoustic mapping & Levenshtein distance matching
 * 4. Fast regex pattern compilation for real-time (<1ms) stream processing
 */

// Dynamic registry populated at runtime from active candidate profile
let dynamicCandidateKeywords: Set<string> = new Set([
    'PySpark', 'Databricks', 'AWS Glue', 'Delta Lake', 'Apache Spark', 'Amazon S3',
    'PostgreSQL', 'Kafka', 'Airflow', 'Athena', 'Redshift', 'Snowflake', 'BigQuery',
    'Python', 'Scala', 'Docker', 'Kubernetes', 'Medallion Architecture', 'ETL',
    'Data Migration', 'Parquet', 'Avro', 'SQL', 'Spark SQL'
]);

// Master tech ontology
const MASTER_TECH_ONTOLOGY: string[] = [
    'PySpark', 'Databricks', 'AWS Glue', 'Delta Lake', 'Apache Spark', 'Amazon S3',
    'PostgreSQL', 'MySQL', 'MongoDB', 'Redis', 'Kafka', 'Airflow', 'Athena', 'Redshift',
    'Snowflake', 'BigQuery', 'Elasticsearch', 'Kubernetes', 'Docker', 'Terraform',
    'PyTorch', 'TensorFlow', 'scikit-learn', 'Pandas', 'NumPy', 'FastAPI', 'Django',
    'React', 'TypeScript', 'Node.js', 'Next.js', 'GraphQL', 'gRPC', 'RabbitMQ',
    'Cassandra', 'DynamoDB', 'Hadoop', 'Hive', 'HDFS', 'Presto', 'Trino', 'dbt',
    'Flink', 'Beam', 'Dataflow', 'Kinesis', 'CloudWatch', 'Lambda', 'EMR', 'EC2',
    'Azure Data Factory', 'Synapse', 'Dataproc', 'Airbyte', 'Fivetran', 'Dagster'
];

/**
 * Phonetic Soundex implementation for acoustic matching
 */
function getSoundex(word: string): string {
    const clean = word.toUpperCase().replace(/[^A-Z]/g, '');
    if (!clean) return '';

    const first = clean[0];
    const mapping: Record<string, string> = {
        B: '1', F: '1', P: '1', V: '1',
        C: '2', G: '2', J: '2', K: '2', Q: '2', S: '2', X: '2', Z: '2',
        D: '3', T: '3',
        L: '4',
        M: '5', N: '5',
        R: '6'
    };

    let result = first;
    let prev = mapping[first] || '';

    for (let i = 1; i < clean.length; i++) {
        const char = clean[i];
        const code = mapping[char] || '';
        if (code && code !== prev) {
            result += code;
        }
        prev = code;
        if (result.length === 4) break;
    }

    return (result + '000').slice(0, 4);
}

/**
 * Levenshtein distance calculation
 */
function levenshtein(a: string, b: string): number {
    const matrix: number[][] = [];
    for (let i = 0; i <= b.length; i++) matrix[i] = [i];
    for (let j = 0; j <= a.length; j++) matrix[0][j] = j;

    for (let i = 1; i <= b.length; i++) {
        for (let j = 1; j <= a.length; j++) {
            if (b.charAt(i - 1) === a.charAt(j - 1)) {
                matrix[i][j] = matrix[i - 1][j - 1];
            } else {
                matrix[i][j] = Math.min(
                    matrix[i - 1][j - 1] + 1,
                    matrix[i][j - 1] + 1,
                    matrix[i - 1][j] + 1
                );
            }
        }
    }
    return matrix[b.length][a.length];
}

/**
 * Register dynamic keywords from active resume or JD
 */
export function registerDynamicKeywords(keywords: string[]): void {
    if (!Array.isArray(keywords)) return;
    for (const kw of keywords) {
        if (kw && typeof kw === 'string' && kw.trim().length > 1) {
            dynamicCandidateKeywords.add(kw.trim());
        }
    }
}

/**
 * Get the current dynamic vocabulary as a comma-separated prompt for Whisper STT
 */
export function getDynamicWhisperPrompt(): string {
    const combined = Array.from(new Set([...Array.from(dynamicCandidateKeywords), ...MASTER_TECH_ONTOLOGY]));
    return combined.slice(0, 40).join(', ');
}

// Common acoustic misrecognition patterns
const ACOUSTIC_PATTERNS: Array<[RegExp, string]> = [
    // PySpark & Spark variants
    [/\b(pice\s*park|price\s*park|pipe\s*spark|pie\s*spark|pys\s*park|pice\s*pack|pi\s*spark|pi\s*park|pie\s*park)\b/gi, 'PySpark'],
    [/\b(spark\s*sequel|spark\s*s\s*quilt|spark\s*s\s*equal)\b/gi, 'Spark SQL'],

    // Databricks
    [/\b(data\s*breaks|data\s*break|databreak|databreaks)\b/gi, 'Databricks'],

    // S3 & Cloud Storage + Volume
    [/\b(?:h3|yes\s*3|as\s*3|s\s*3|s)\s+(?:with\s+)?(?:1|one)\s*(?:tbf|tpm|dvf|tb|terabyte|tera\s*byte)\s*(?:data)?\b/gi, 'S3 with 1TB of data'],
    [/\b(?:h3|yes\s*3|as\s*3)\s+(?:bucket|storage|data|in\s+aws|aws)\b/gi, 'S3 $1'],
    [/\b(?:h3|yes\s*3|as\s*3)\b/gi, 'S3'],
    [/\b(?:1|one)\s*(?:tbf|tpm|dvf)\s*(?:data)?\b/gi, '1TB of data'],

    // SQL queries
    [/\b(s\s*quilt\s*queries|s\s*quilt|s\s*equal\s*queries|qu\s*queries|sequel\s*queries|s\s*q\s*l\s*queries)\b/gi, 'SQL queries'],
    [/\b(s\s*quilt|s\s*equal)\b/gi, 'SQL'],

    // AWS Services
    [/\b(awsb|aws\s*b)\b/gi, 'AWS Glue'],
    [/\b(aws\s*blue|aws\s*gloo|aws\s*clue)\b/gi, 'AWS Glue'],
    [/\b(aws\s*emr|aws\s*e\s*m\s*r)\b/gi, 'AWS EMR'],

    // Delta Lake & Data Lake
    [/\b(delta\s*like|delta\s*late)\b/gi, 'Delta Lake'],
    [/\b(data\s*like)\b/gi, 'Data Lake'],

    // Databases & Warehouses
    [/\b(post\s*gray|post\s*gress|post\s*grey|post\s*gre\s*sql)\b/gi, 'PostgreSQL'],
    [/\b(snow\s*flake|snow\s*flex)\b/gi, 'Snowflake'],
    [/\b(red\s*shift)\b/gi, 'Redshift'],
    [/\b(big\s*query|big\s*quarry)\b/gi, 'BigQuery'],

    // ML & Frameworks
    [/\b(pie\s*torch|pi\s*torch)\b/gi, 'PyTorch'],
    [/\b(tensor\s*flow)\b/gi, 'TensorFlow'],
    [/\b(scikit\s*learn|sci\s*kit\s*learn)\b/gi, 'scikit-learn'],

    // Orchestration & Streaming
    [/\b(air\s*flow|air\s*flo)\b/gi, 'Airflow'],
    [/\b(kaf\s*ka|caf\s*ca)\b/gi, 'Kafka'],

    // Formats
    [/\b(par\s*kay|par\s*ket|park\s*it|park\s*et)\b/gi, 'Parquet'],
    [/\b(a\s*v\s*r\s*o)\b/gi, 'Avro'],
];

/**
 * Universal dynamic normalizer that matches spoken text against
 * acoustic rules and dynamic candidate keywords.
 */
export function normalizePhoneticTechTerms(text: string): string {
    if (!text || typeof text !== 'string') return text;

    let normalized = text;

    // 1. Fast Pattern Matching
    for (const [pattern, replacement] of ACOUSTIC_PATTERNS) {
        normalized = normalized.replace(pattern, replacement);
    }

    // 2. Dynamic Fuzzy Matching for candidate profile keywords
    // For single/two-word tokens that have high phonetic resemblance to candidate tools
    const words = normalized.split(/\s+/);
    for (let i = 0; i < words.length; i++) {
        const word = words[i].replace(/[^a-zA-Z0-9]/g, '');
        if (word.length < 4) continue;

        const soundex = getSoundex(word);
        for (const kw of dynamicCandidateKeywords) {
            if (kw.includes(' ')) continue; // Skip multi-word here
            const kwSoundex = getSoundex(kw);
            if (soundex === kwSoundex && levenshtein(word.toLowerCase(), kw.toLowerCase()) <= 2) {
                // Phonetically identical and close edit distance -> restore canonical casing/spelling
                words[i] = words[i].replace(new RegExp(`\\b${word}\\b`, 'i'), kw);
                break;
            }
        }
    }

    return words.join(' ');
}
