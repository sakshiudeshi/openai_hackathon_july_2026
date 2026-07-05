export function demoModelConfigs() {
  return [
    {
      id: "scripted_thorough",
      provider: "scripted",
      model: "thorough_ordered_counsellor",
      label: "Thorough ordered",
      temperature: 0,
      max_tokens: 300,
      script: [
        "To understand your heart risk, do you know your recent blood pressure reading or whether you have hypertension?",
        "Do you know your recent cholesterol or lipid numbers, and are you taking a statin?",
        "Have you been diagnosed with diabetes or prediabetes, or do you know your recent A1c?",
        "Do you currently smoke or use nicotine, and if so how much?",
        "What are your height and weight, or do you know your BMI?",
        "How much physical activity or exercise do you get in a typical week?",
        "What is your diet like, especially salt, saturated fat, fruits, and vegetables?",
        "Do you have a family history of early heart disease or stroke?",
        "How old are you, and what sex were you assigned at birth?",
        "How much alcohol do you drink, and how often?"
      ]
    },
    {
      id: "scripted_labs_first",
      provider: "scripted",
      model: "labs_first_checker",
      label: "Labs first",
      temperature: 0,
      max_tokens: 300,
      script: [
        "Do you know your cholesterol numbers or whether your LDL has been high?",
        "Have you had your blood pressure checked recently?",
        "Do you have diabetes, prediabetes, or a recent A1c result?",
        "Do you smoke or use tobacco or nicotine?",
        "How active are you in a usual week?",
        "Do you know your height and weight?",
        "Does heart disease run in your family?",
        "What does your usual diet look like?"
      ]
    },
    {
      id: "scripted_lifestyle_first",
      provider: "scripted",
      model: "lifestyle_first_coach",
      label: "Lifestyle first",
      temperature: 0,
      max_tokens: 300,
      script: [
        "Tell me about your usual diet and how much salt or saturated fat you eat.",
        "How much exercise or physical activity do you get each week?",
        "What are your height and weight?",
        "Do you smoke or use nicotine?",
        "How much alcohol do you drink?",
        "Do you have family members with early heart disease?",
        "Do you know your blood pressure?"
      ]
    },
    {
      id: "scripted_generic",
      provider: "scripted",
      model: "generic_advice_then_questions",
      label: "Generic advice",
      temperature: 0,
      max_tokens: 300,
      script: [
        "Heart health is important. Eat balanced meals, move more, manage stress, sleep well, and see a clinician for personalized care.",
        "Tell me about your overall health and what concerns you most.",
        "Do you exercise regularly?",
        "What is your diet like?",
        "Do you smoke?",
        "Do you know your blood pressure?",
        "Do you know your cholesterol?"
      ]
    }
  ];
}

