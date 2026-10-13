class Task < ApplicationRecord
  belongs_to :session

  validates :name, presence: true
  validates :session_id, presence: true
  validates :duration_minutes, numericality: { only_integer: true, greater_than_or_equal_to: 0 }, allow_nil: true
end
