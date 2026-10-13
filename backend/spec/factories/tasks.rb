# frozen_string_literal: true

FactoryBot.define do
  factory :task do
    session
    name { 'Working on documentation' }
    duration_minutes { 0 }
  end
end
