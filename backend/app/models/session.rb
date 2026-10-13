class Session < ApplicationRecord
  has_many :tasks, dependent: :destroy

  enum :status, { active: 0, completed: 1 }

  validates :status, presence: true
end
