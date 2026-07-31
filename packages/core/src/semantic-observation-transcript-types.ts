export type ExplicitObservationTranscript = {
  shape:
    | "existing_observation"
    | "successful_test"
    | "concrete_test_result"
    | "abbreviated_file_view"
    | "procedural_harness_observation";
  consequenceBaseline: "low" | "medium" | "high";
};
