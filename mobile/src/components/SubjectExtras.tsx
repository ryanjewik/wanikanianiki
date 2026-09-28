/**
 * The rest of what WaniKani says about an item, shown under the lesson and on
 * the item detail screen: hints, parts of speech, context sentences, and kanji
 * that are easy to mistake for this one.
 *
 * Each section renders only when WaniKani sent something for it — a radical
 * has none of these, a kanji no sentences, a word no look-alikes — so the
 * screens can drop this in unconditionally.
 */
import { useRouter } from 'expo-router';
import * as React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Card, Overline, Pill } from '@/components/ui';
import type { Subject } from '@/data/types';
import { feedback } from '@/feedback';
import { playRecording } from '@/feedback/audio';
import { speakJapanese } from '@/feedback/speech';
import { useSubjects } from '@/hooks/useStudyData';
import { colors, jp, radius, subjectPalette, type as typeScale } from '@/theme/tokens';

/** Sentences shown per word. WaniKani sends three; all three fit. */
const SENTENCE_LIMIT = 3;

/**
 * Says an item out loud. A vocabulary word plays WaniKani's own recording when
 * there is one — a real voice, and right for pitch accent where the phone's
 * speech engine is not. Everything else falls back to that engine: a kanji or
 * radical by its primary reading, since a bare kanji has no single
 * pronunciation.
 */
export function speakSubject(subject: Subject): void {
  const recording = subject.pronunciationAudios?.[0]?.url;
  if (recording && playRecording(recording)) return;

  const text =
    subject.type === 'vocabulary'
      ? (subject.characters ?? '')
      : ((subject.readings.find((r) => r.primary) ?? subject.readings[0])?.reading ?? '');
  speakJapanese(text);
}

export function SubjectExtras({ subject }: { subject: Subject }) {
  const router = useRouter();
  const palette = subjectPalette[subject.type];
  const { data: similar } = useSubjects(subject.visuallySimilarSubjectIds ?? []);

  const partsOfSpeech = subject.partsOfSpeech ?? [];
  const sentences = (subject.contextSentences ?? []).slice(0, SENTENCE_LIMIT);
  const hints = [
    subject.meaningHint ? { label: 'Meaning hint', text: subject.meaningHint } : null,
    subject.readingHint ? { label: 'Reading hint', text: subject.readingHint } : null,
  ].filter((hint): hint is { label: string; text: string } => hint !== null);

  return (
    <>
      {hints.map((hint) => (
        <Card key={hint.label} variant="bordered" style={styles.hintCard}>
          <Overline style={{ color: palette.ink }}>{hint.label}</Overline>
          <Text style={styles.hintText}>{hint.text}</Text>
        </Card>
      ))}

      {partsOfSpeech.length > 0 ? (
        <Card>
          <Overline style={styles.groupLabel}>Word type</Overline>
          <View style={styles.pillRow}>
            {partsOfSpeech.map((part) => (
              <Pill key={part} label={part} color={palette.ink} background={palette.tint} />
            ))}
          </View>
        </Card>
      ) : null}

      {sentences.length > 0 ? (
        <Card style={styles.sentences}>
          <Overline>Context sentences</Overline>
          {sentences.map((sentence, index) => (
            <Pressable
              key={index}
              onPress={() => speakJapanese(sentence.ja)}
              onPressIn={feedback.tap}
              accessibilityRole="button"
              accessibilityLabel={`Read aloud: ${sentence.en}`}
            >
              {({ pressed }) => (
                <View style={[styles.sentence, pressed && styles.sentencePressed]}>
                  <Text style={styles.sentenceJa}>{sentence.ja}</Text>
                  <Text style={styles.sentenceEn}>{sentence.en}</Text>
                </View>
              )}
            </Pressable>
          ))}
          <Text style={styles.footnote}>Tap a sentence to hear it.</Text>
        </Card>
      ) : null}

      {similar && similar.length > 0 ? (
        <Card>
          <Overline style={styles.groupLabel}>Looks like</Overline>
          <View style={styles.similarRow}>
            {similar.map((other) => (
              <Pressable
                key={other.id}
                onPress={() => router.push(`/item/${other.id}`)}
                onPressIn={feedback.select}
              >
                {({ pressed }) => (
                  <View style={[styles.similarTile, pressed && styles.sentencePressed]}>
                    <Text style={styles.similarGlyph}>{other.characters}</Text>
                    <Text style={styles.similarMeaning} numberOfLines={1}>
                      {(other.meanings.find((m) => m.primary) ?? other.meanings[0])?.meaning}
                    </Text>
                  </View>
                )}
              </Pressable>
            ))}
          </View>
        </Card>
      ) : null}
    </>
  );
}

const styles = StyleSheet.create({
  groupLabel: {
    marginBottom: 10,
  },
  hintCard: {
    gap: 6,
  },
  hintText: {
    ...typeScale.bodyLoose,
    color: colors.inkMuted,
  },
  pillRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  sentences: {
    gap: 10,
  },
  sentence: {
    borderRadius: radius.control,
    paddingVertical: 8,
    paddingHorizontal: 10,
    backgroundColor: colors.ground,
    gap: 3,
  },
  sentencePressed: {
    opacity: 0.6,
  },
  sentenceJa: {
    ...jp.row,
    fontSize: 16,
    lineHeight: 24,
    color: colors.ink,
  },
  sentenceEn: {
    ...typeScale.caption,
    color: colors.inkSoft,
    lineHeight: 17,
  },
  footnote: {
    ...typeScale.metaSmall,
    color: colors.inkFaint,
  },
  similarRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 9,
  },
  similarTile: {
    minWidth: 76,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.control,
    paddingVertical: 8,
    paddingHorizontal: 12,
    alignItems: 'center',
    gap: 2,
  },
  similarGlyph: {
    ...jp.chip,
    color: colors.ink,
  },
  similarMeaning: {
    ...typeScale.metaSmall,
    color: colors.inkSoft,
  },
});
